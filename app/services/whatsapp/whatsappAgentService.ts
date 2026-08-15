import crypto from "crypto";
import { Prisma, WhatsAppMensagemDirecao, WhatsAppMensagemOrigem, WhatsAppMensagemStatus, WhatsAppMensagemTipo } from "../../../generated";
import { prisma } from "../../utils/prisma";
import { WApiClient, wApiMessageIdFromResponse } from "./wApiClient";
import { downloadAndDecryptWhatsAppMedia } from "./whatsappMedia";
import { AgentHistoryItem, generateAgentReply, geminiSupportsMime } from "./whatsappAgentAI";
import { iaPlatformService } from "../ia/iaPlatformService";
import { iaUsageService } from "../ia/iaUsageService";
import { sendWhatsAppConversationUpdated, sendWhatsAppMessageCreated } from "../../hooks/whatsapp/socket";
import { contaHasActiveModule } from "../contas/storeModulesService";
import { createRestaurantOrderFromAssistant, restaurantAssistantContext } from "./restaurantAgentTools";

export interface AgentInput {
  nome: string;
  prompt: string;
  modelo?: string;
  ativo?: boolean;
  delaySegundos?: number;
  horaInicio?: string | null;
  horaFim?: string | null;
  diasSemana?: string | null;
  instanciaIds?: number[];
}

const CONVERSATION_INCLUDE = {
  Contato: true,
  Cliente: { select: { id: true, nome: true, telefone: true, whastapp: true } },
  Atendente: { select: { id: true, nome: true } },
  Instancia: { select: { id: true, nome: true, status: true, numeroConectado: true } },
  AgenteAtual: { select: { id: true, nome: true } },
} satisfies Prisma.WhatsAppConversaInclude;

const RESTAURANT_INTENT = /\b(card[aá]pio|restaurante|pedido|pedir|lanche|pizza|hamb[uú]rguer|hamburger|complemento|adicional|entrega|retirada|pix)\b/i;

function wantsRestaurantTools(text: string, history: AgentHistoryItem[]) {
  return RESTAURANT_INTENT.test(`${history.map((item) => item.text).join(" ")} ${text}`);
}

function stripInternalDirectives(text: string) {
  const start = text.search(/\[\[CRIAR_PEDIDO:/i);
  const end = start >= 0 ? endOfOrderDirective(text, start) : -1;
  return (end >= 0 ? `${text.slice(0, start)}${text.slice(end)}` : text)
    .replace(/^\s*(?:\[\[)?\/?transferir\s*[: ]\s*\d+\s*(?:\]\])?\s*$/gim, "")
    .trim();
}

function transferDirective(text: string) {
  // Aceita a diretiva em uma linha isolada mesmo quando o modelo acrescenta uma frase antes
  // ou depois. O comando ainda precisa apontar para um agente elegível do tenant.
  const match = text.match(/^\s*(?:\[\[)?\/?transferir\s*[: ]\s*(\d+)\s*(?:\]\])?\s*$/im);
  return match ? Number(match[1]) : null;
}

function orderDirective(text: string): unknown | null {
  const start = text.search(/\[\[CRIAR_PEDIDO:/i);
  if (start < 0) return null;
  const prefixEnd = text.indexOf(":", start) + 1;
  const jsonStart = text.indexOf("{", prefixEnd);
  const end = endOfOrderDirective(text, start);
  if (jsonStart < 0 || end < 0) return null;
  try { return JSON.parse(text.slice(jsonStart, end - 2).trim()); } catch { return null; }
}

// A diretiva contém JSON aninhado (cliente/endereço/itens); regex não é segura para achar seu fim.
function endOfOrderDirective(text: string, start: number) {
  const jsonStart = text.indexOf("{", start);
  if (jsonStart < 0) return -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = jsonStart; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0 && text.slice(index + 1, index + 3) === "]]" ) return index + 3;
    }
  }
  return -1;
}

function normalizeDias(value?: string | null): string {
  const dias = String(value ?? "0,1,2,3,4,5,6")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^[0-6]$/.test(item));
  return Array.from(new Set(dias)).join(",") || "0,1,2,3,4,5,6";
}

export function normalizeHora(value?: string | null): string | null {
  const hora = String(value ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(hora) ? hora : null;
}

function normalizeDelay(value?: number | null): number {
  const delay = Number(value);
  return Number.isInteger(delay) && delay >= 0 && delay <= 120 ? delay : 0;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Enquanto o agente aguarda, novas mensagens do cliente reiniciam a contagem por meio
// do seu próprio processamento. Só a última mensagem recebida pode disparar a IA.
async function canGenerateReplyAfterDelay(contaId: number, conversaId: number, incomingMessageId: number) {
  const [conversa, latestIncoming] = await Promise.all([
    prisma.whatsAppConversa.findFirst({
      where: { id: conversaId, contaId },
      select: { status: true, atendenteId: true },
    }),
    prisma.whatsAppMensagem.findFirst({
      where: { contaId, conversaId, direcao: WhatsAppMensagemDirecao.ENTRADA },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    }),
  ]);

  return conversa?.status === "PENDENTE"
    && !conversa.atendenteId
    && latestIncoming?.id === incomingMessageId;
}

// Está dentro da janela de horário [inicio, fim] (fuso America/Sao_Paulo)? Horário não definido
// (qualquer um dos dois nulo/ inválido) = sempre dentro. Suporta janela que cruza a meia-noite.
export function withinBusinessHours(horaInicio?: string | null, horaFim?: string | null, now = new Date()): boolean {
  const inicio = normalizeHora(horaInicio);
  const fim = normalizeHora(horaFim);
  if (!inicio || !fim) return true;
  const { minutes } = saoPauloDayAndMinutes(now);
  const start = hmToMinutes(inicio);
  const end = hmToMinutes(fim);
  if (start <= end) return minutes >= start && minutes <= end;
  return !(minutes < start && minutes > end);
}

function hmToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

// Dia da semana (0=domingo) e minutos do dia no fuso America/Sao_Paulo.
function saoPauloDayAndMinutes(now = new Date()): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const wd = parts.find((p) => p.type === "weekday")?.value || "Sun";
  const hourRaw = Number(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value || "0");
  const hour = hourRaw === 24 ? 0 : hourRaw;
  return { day: map[wd] ?? 0, minutes: hour * 60 + minute };
}

// Regras de atendimento: ativo + dia da semana permitido + dentro da janela de horário.
export function agentAttendsNow(
  agent: { ativo: boolean; diasSemana: string; horaInicio: string | null; horaFim: string | null },
  now = new Date(),
): boolean {
  if (!agent.ativo) return false;
  const { day, minutes } = saoPauloDayAndMinutes(now);

  const dias = normalizeDias(agent.diasSemana).split(",");
  if (!dias.includes(String(day))) return false;

  const inicio = normalizeHora(agent.horaInicio);
  const fim = normalizeHora(agent.horaFim);
  if (inicio && fim) {
    const start = hmToMinutes(inicio);
    const end = hmToMinutes(fim);
    if (start <= end) {
      if (minutes < start || minutes > end) return false;
    } else {
      // janela que cruza a meia-noite (ex.: 22:00 -> 06:00)
      if (minutes < start && minutes > end) return false;
    }
  }
  return true;
}

function publicAgent(agent: any) {
  if (!agent) return agent;
  const instanciaIds = Array.isArray(agent.instancias) ? agent.instancias.map((i: any) => i.instanciaId) : [];
  const { instancias: _instancias, ...rest } = agent;
  return { ...rest, instanciaIds };
}

async function assertInstancesOwnership(contaId: number, instanciaIds: number[]) {
  if (!instanciaIds.length) return;
  const count = await prisma.whatsAppInstancia.count({ where: { contaId, id: { in: instanciaIds } } });
  if (count !== instanciaIds.length) {
    throw new Error("Uma ou mais instâncias selecionadas não pertencem à conta");
  }
}

// Substitui os vínculos de instância do agente. Como cada instância só pode ser triada por um
// agente (unique), assumir uma instância a remove automaticamente de qualquer outro agente.
async function setAgentInstances(contaId: number, agenteId: number, instanciaIds: number[]) {
  const ids = Array.from(new Set((instanciaIds || []).filter((id) => Number.isInteger(id) && id > 0)));
  await assertInstancesOwnership(contaId, ids);

  await prisma.$transaction([
    prisma.whatsAppAgenteInstancia.deleteMany({ where: { contaId, agenteId } }),
    ...(ids.length
      ? [
          // libera as instâncias de outros agentes antes de reatribuir
          prisma.whatsAppAgenteInstancia.deleteMany({ where: { contaId, instanciaId: { in: ids } } }),
          prisma.whatsAppAgenteInstancia.createMany({
            data: ids.map((instanciaId) => ({ contaId, agenteId, instanciaId })),
          }),
        ]
      : []),
  ]);
}

// Garante que o modelo escolhido está entre os liberados pelo CEO (modelos ativos).
async function assertModeloPermitido(modelo?: string) {
  if (!modelo) return;
  const permitidos = await iaPlatformService.getActiveModelIds();
  if (!permitidos.includes(modelo)) {
    throw new Error("Modelo de IA não permitido. Escolha um dos modelos liberados pela plataforma.");
  }
}

export const whatsAppAgentService = {
  async listAgents(contaId: number) {
    const agents = await prisma.whatsAppAgente.findMany({
      where: { contaId },
      orderBy: [{ ativo: "desc" }, { updatedAt: "desc" }],
      include: { instancias: { where: { Instancia: { ativo: true } }, select: { instanciaId: true } } },
    });
    return agents.map(publicAgent);
  },

  async getAgent(contaId: number, id: number) {
    const agent = await prisma.whatsAppAgente.findFirst({
      where: { id, contaId },
      include: { instancias: { where: { Instancia: { ativo: true } }, select: { instanciaId: true } } },
    });
    if (!agent) throw new Error("Agente não encontrado para esta conta");
    return publicAgent(agent);
  },

  async createAgent(contaId: number, input: AgentInput) {
    const permitidos = await iaPlatformService.getActiveModelIds();
    const modelo = input.modelo?.trim() || permitidos[0] || "gemini-2.0-flash";
    await assertModeloPermitido(modelo);
    const agent = await prisma.whatsAppAgente.create({
      data: {
        contaId,
        nome: input.nome.trim(),
        prompt: input.prompt.trim(),
        modelo,
        ativo: input.ativo ?? true,
        delaySegundos: normalizeDelay(input.delaySegundos),
        horaInicio: normalizeHora(input.horaInicio),
        horaFim: normalizeHora(input.horaFim),
        diasSemana: normalizeDias(input.diasSemana),
      },
    });
    await setAgentInstances(contaId, agent.id, input.instanciaIds || []);
    return this.getAgent(contaId, agent.id);
  },

  async updateAgent(contaId: number, id: number, input: Partial<AgentInput>) {
    await this.getAgent(contaId, id);
    const data: Prisma.WhatsAppAgenteUpdateInput = {};
    if (typeof input.nome === "string") data.nome = input.nome.trim();
    if (typeof input.prompt === "string") data.prompt = input.prompt.trim();
    if (typeof input.modelo === "string" && input.modelo.trim()) {
      await assertModeloPermitido(input.modelo.trim());
      data.modelo = input.modelo.trim();
    }
    if (typeof input.ativo === "boolean") data.ativo = input.ativo;
    if (typeof input.delaySegundos === "number") data.delaySegundos = normalizeDelay(input.delaySegundos);
    if ("horaInicio" in input) data.horaInicio = normalizeHora(input.horaInicio);
    if ("horaFim" in input) data.horaFim = normalizeHora(input.horaFim);
    if ("diasSemana" in input) data.diasSemana = normalizeDias(input.diasSemana);

    await prisma.whatsAppAgente.update({ where: { id }, data });
    if (input.instanciaIds) await setAgentInstances(contaId, id, input.instanciaIds);
    return this.getAgent(contaId, id);
  },

  async removeAgent(contaId: number, id: number) {
    await this.getAgent(contaId, id);
    await prisma.whatsAppAgente.delete({ where: { id } });
    return { id };
  },

  // Homologação segura: usa instruções e consultas reais, mas não cria pedido, não transfere
  // conversa e não envia nenhuma mensagem ao WhatsApp.
  async testAgent(contaId: number, id: number, message: string, history: AgentHistoryItem[] = []) {
    const agent = await prisma.whatsAppAgente.findFirst({ where: { id, contaId } });
    if (!agent) throw new Error("Agente não encontrado para esta conta");
    const apiKey = await iaPlatformService.getDefaultApiKey();
    if (!apiKey) throw new Error("Nenhuma chave de IA está configurada pela plataforma");
    const targets = await prisma.whatsAppAgente.findMany({ where: { contaId, id: { not: id }, ativo: true }, select: { id: true, nome: true, ativo: true, diasSemana: true, horaInicio: true, horaFim: true } });
    const restaurant = wantsRestaurantTools(message, history) ? await restaurantAssistantContext(contaId) : null;
    const eligibleTargets = targets.filter(agentAttendsNow);
    let activeAgent = agent;
    let reply = await generateAgentReply({ apiKey, modelo: agent.modelo, systemPrompt: buildSystemPrompt(agent, eligibleTargets, restaurant?.prompt, true), history, userText: message });
    await iaUsageService.recordUsage({ contaId, feature: "atendimento_agente_teste", modelId: agent.modelo, ...reply.usage });
    let transferredTo: { id: number; nome: string } | null = null;
    const transferTo = transferDirective(reply.text || "");
    if (transferTo) {
      const target = eligibleTargets.find((candidate) => candidate.id === transferTo);
      if (target) {
        const nextAgent = await prisma.whatsAppAgente.findFirst({ where: { id: target.id, contaId } });
        if (nextAgent) {
          activeAgent = nextAgent;
          transferredTo = { id: nextAgent.id, nome: nextAgent.nome };
          reply = await generateAgentReply({ apiKey, modelo: nextAgent.modelo, systemPrompt: buildSystemPrompt(nextAgent, [], restaurant?.prompt, true), history, userText: message });
          await iaUsageService.recordUsage({ contaId, feature: "atendimento_agente_teste", modelId: nextAgent.modelo, ...reply.usage });
        }
      }
    }
    return { text: stripInternalDirectives(reply.text || "") || "O agente não gerou uma resposta.", restaurantToolsEnabled: Boolean(restaurant), agent: { id: activeAgent.id, nome: activeAgent.nome }, transferredTo };
  },

  // Autoatendimento: chamado ao receber uma mensagem do cliente. Só age se a conversa está em
  // espera, sem atendente humano, e existe um agente ativo e dentro do horário para a instância.
  async handleIncomingForAgent(params: {
    contaId: number;
    instance: { id: number; instanceId: string; token: string };
    conversa: { id: number; telefone: string; status: string; atendenteId: number | null };
    incoming: { conteudo: string; tipo: string };
    incomingMessageId: number;
    payload: any;
  }) {
    const { contaId, instance, conversa, incoming } = params;
    try {
      if (!(await contaHasActiveModule(contaId, "core-ia"))) return;
      if (conversa.status !== "PENDENTE" || conversa.atendenteId) return;

      const assigned = await prisma.whatsAppConversa.findFirst({ where: { id: conversa.id, contaId }, select: { agenteId: true } });
      const assignedAgent = assigned?.agenteId
        ? await prisma.whatsAppAgente.findFirst({ where: { id: assigned.agenteId, contaId } })
        : null;
      const link = assignedAgent ? null : await prisma.whatsAppAgenteInstancia.findUnique({
        where: { contaId_instanciaId: { contaId, instanciaId: instance.id } }, include: { Agente: true },
      });
      let agent = assignedAgent || link?.Agente;
      if (!agent || !agentAttendsNow(agent)) return;

      const delayMs = normalizeDelay(agent.delaySegundos) * 1000;
      if (delayMs) {
        await wait(delayMs);
        if (!(await canGenerateReplyAfterDelay(contaId, conversa.id, params.incomingMessageId))) return;

        // A configuração pode ter mudado durante a espera; não gere com um agente desativado.
        const refreshedAgent = await prisma.whatsAppAgente.findFirst({ where: { id: agent.id, contaId, ativo: true } });
        if (!refreshedAgent || !agentAttendsNow(refreshedAgent)) return;
        agent = refreshedAgent;
      }

      const previas = await prisma.whatsAppMensagem.findMany({
        where: { contaId, conversaId: conversa.id, id: { not: params.incomingMessageId } },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { direcao: true, conteudo: true },
      });
      const history: AgentHistoryItem[] = previas
        .reverse()
        .filter((m) => m.conteudo?.trim())
        .map((m) => ({
          role: m.direcao === WhatsAppMensagemDirecao.SAIDA ? "model" : "user",
          text: m.conteudo as string,
        }));

      // Anexos: descriptografa a mídia recebida e envia ao Gemini quando o tipo é suportado.
      let media = null as { mimeType: string; dataBase64: string } | null;
      const tiposMidia = ["IMAGEM", "AUDIO", "VIDEO", "DOCUMENTO", "STICKER"];
      if (tiposMidia.includes(incoming.tipo)) {
        try {
          const decrypted = await downloadAndDecryptWhatsAppMedia(params.payload);
          if (geminiSupportsMime(decrypted.mimetype)) {
            media = { mimeType: decrypted.mimetype, dataBase64: decrypted.buffer.toString("base64") };
          }
        } catch (error) {
          console.warn(`[whatsapp-agent] falha ao decifrar mídia para o agente conversa=${conversa.id}`, error);
        }
      }

      const apiKey = await iaPlatformService.getDefaultApiKey();
      if (!apiKey) {
        console.warn("[whatsapp-agent] nenhuma chave de API de IA configurada; autoatendimento ignorado");
        return;
      }

      const transferTargets = await prisma.whatsAppAgente.findMany({
        where: { contaId, id: { not: agent.id }, ativo: true },
        select: { id: true, nome: true, ativo: true, diasSemana: true, horaInicio: true, horaFim: true },
      });
      const eligibleTargets = transferTargets.filter(agentAttendsNow);
      const restaurant = wantsRestaurantTools(incoming.conteudo || "", history)
        ? await restaurantAssistantContext(contaId)
        : null;
      let reply = await generateAgentReply({
        apiKey,
        modelo: agent.modelo,
        systemPrompt: buildSystemPrompt(agent, eligibleTargets, restaurant?.prompt),
        history,
        userText: incoming.conteudo || (media ? "(o cliente enviou um anexo)" : "(mensagem sem texto)"),
        media,
      });

      // Registra o consumo do agente (o modelo é o escolhido pelo cliente no agente).
      await iaUsageService.recordUsage({
        contaId,
        feature: "atendimento_agente",
        modelId: agent.modelo,
        ...reply.usage,
      });

      const transferTo = transferDirective(reply.text || "");
      if (transferTo) {
        const target = eligibleTargets.find((candidate) => candidate.id === transferTo);
        if (target) {
          const nextAgent = await prisma.whatsAppAgente.findFirst({ where: { id: target.id, contaId } });
          if (nextAgent) {
            await prisma.$transaction([
              prisma.whatsAppConversa.update({ where: { id: conversa.id }, data: { agenteId: nextAgent.id } }),
              prisma.whatsAppConversaEvento.create({ data: { contaId, conversaId: conversa.id, tipo: "TRANSFERIDA_AGENTE" } }),
            ]);
            agent = nextAgent;
            reply = await generateAgentReply({
              apiKey, modelo: agent.modelo, systemPrompt: buildSystemPrompt(agent, [], restaurant?.prompt), history,
              userText: incoming.conteudo || "(mensagem sem texto)", media,
            });
            await iaUsageService.recordUsage({ contaId, feature: "atendimento_agente", modelId: agent.modelo, ...reply.usage });
          }
        }
      }

      const draft = restaurant ? orderDirective(reply.text || "") : null;
      let responseText = stripInternalDirectives(reply.text || "");
      let pixQrCode: string | null = null;
      if (draft) {
        try {
          const order = await createRestaurantOrderFromAssistant({ contaId, idempotencyKey: `wa-agent-${conversa.id}-${params.incomingMessageId}`, draft });
          const total = new Decimal(order.pedido.total).toFixed(2).replace(".", ",");
          responseText = `Pedido ${order.pedido.codigo} confirmado. Total: R$ ${total}.`;
          if (order.paymentAction?.pixCopiaCola) {
            responseText += `\n\nPix copia e cola:\n${order.paymentAction.pixCopiaCola}\n\nEnviei também o QR Code para pagamento.`;
            pixQrCode = order.paymentAction.qrCodeDataUrl || null;
          }
        } catch (error: any) {
          responseText = error?.message || "Não foi possível confirmar o pedido. Revise os dados e tente novamente.";
        }
      }
      if (responseText) {
        await this.sendAgentMessage(contaId, instance, conversa.id, conversa.telefone, responseText);
      }
      if (pixQrCode) {
        await this.sendAgentImage(contaId, instance, conversa.id, conversa.telefone, pixQrCode, "QR Code Pix do pedido");
      }
    } catch (error) {
      console.warn(`[whatsapp-agent] falha no autoatendimento conversa=${conversa.id}`, error);
    }
  },

  // Envia a resposta do agente. Mantém a conversa em ESPERA (PENDENTE) para o agente seguir
  // atendendo até um humano assumir; não marca ABERTA como o envio manual faz.
  async sendAgentMessage(contaId: number, instance: { id: number; instanceId: string; token: string }, conversaId: number, telefone: string, text: string) {
    const messageId = `agent-${contaId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const pending = await prisma.whatsAppMensagem.create({
      data: {
        contaId,
        conversaId,
        instanciaId: instance.id,
        direcao: WhatsAppMensagemDirecao.SAIDA,
        tipo: WhatsAppMensagemTipo.TEXTO,
        externalMessageId: messageId,
        conteudo: text,
        // Resposta automática: não conta como atendimento humano nos KPIs do painel.
        origem: WhatsAppMensagemOrigem.AGENTE_IA,
        statusEnvio: WhatsAppMensagemStatus.PENDENTE,
      },
    });
    sendWhatsAppMessageCreated(contaId, pending);

    try {
      const client = new WApiClient(instance.instanceId, instance.token);
      const result = await client.send("text", { phone: telefone, message: text, messageId });
      const updated = await prisma.whatsAppMensagem.update({
        where: { id: pending.id },
        data: {
          externalMessageId: wApiMessageIdFromResponse(result) || messageId,
          statusEnvio: WhatsAppMensagemStatus.ENVIADA,
          enviadoEm: new Date(),
          rawPayload: safeJson(result),
        },
      });
      const conversa = await prisma.whatsAppConversa.update({
        where: { id: conversaId },
        data: { ultimaMensagem: text, ultimaInteracaoEm: new Date() },
        include: CONVERSATION_INCLUDE,
      });
      sendWhatsAppMessageCreated(contaId, updated);
      sendWhatsAppConversationUpdated(contaId, conversa);
    } catch (error: any) {
      await prisma.whatsAppMensagem.update({
        where: { id: pending.id },
        data: {
          statusEnvio: WhatsAppMensagemStatus.ERRO,
          erroEnvio: error?.response?.data ? safeJson(error.response.data) : error?.message || "Erro no envio do agente",
        },
      });
    }
  },

  async sendAgentImage(contaId: number, instance: { id: number; instanceId: string; token: string }, conversaId: number, telefone: string, mediaUrl: string, caption: string) {
    const messageId = `agent-image-${contaId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const pending = await prisma.whatsAppMensagem.create({ data: { contaId, conversaId, instanciaId: instance.id, direcao: WhatsAppMensagemDirecao.SAIDA, tipo: WhatsAppMensagemTipo.IMAGEM, externalMessageId: messageId, conteudo: caption, mediaUrl, origem: WhatsAppMensagemOrigem.AGENTE_IA, statusEnvio: WhatsAppMensagemStatus.PENDENTE } });
    sendWhatsAppMessageCreated(contaId, pending);
    try {
      const client = new WApiClient(instance.instanceId, instance.token);
      const result = await client.send("image", { phone: telefone, mediaUrl, caption, messageId });
      const updated = await prisma.whatsAppMensagem.update({ where: { id: pending.id }, data: { externalMessageId: wApiMessageIdFromResponse(result) || messageId, statusEnvio: WhatsAppMensagemStatus.ENVIADA, enviadoEm: new Date(), rawPayload: safeJson(result) } });
      sendWhatsAppMessageCreated(contaId, updated);
    } catch (error: any) {
      await prisma.whatsAppMensagem.update({ where: { id: pending.id }, data: { statusEnvio: WhatsAppMensagemStatus.ERRO, erroEnvio: error?.response?.data ? safeJson(error.response.data) : error?.message || "Erro ao enviar QR Code Pix" } });
    }
  },
};

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

function currentDateTimeInBrasilia(now = new Date()) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
}

function buildSystemPrompt(agent: { nome: string; prompt: string }, transferTargets: Array<{ id: number; nome: string }>, restaurantPrompt?: string, testMode = false): string {
  // Calculado no instante em que cada resposta é gerada, depois de eventual atraso configurado.
  const agora = currentDateTimeInBrasilia();
  return [
    agent.prompt,
    "",
    "--- Instruções do canal ---",
    `Você é ${agent.nome}, um atendente virtual respondendo pelo WhatsApp.`,
    "Responda de forma curta, cordial e objetiva, como em uma conversa de WhatsApp.",
    "Escreva no mesmo idioma do cliente. Não invente informações que você não tem.",
    "Se o cliente pedir algo que exige um humano, informe que vai encaminhar para um atendente.",
    ...(transferTargets.length ? [
      `Agentes especialistas disponíveis: ${transferTargets.map((target) => `${target.nome} (id ${target.id})`).join(", ")}.`,
      "Quando outro especialista for mais adequado, responda somente em uma linha com `/transferir ID`. Isso é interno e não deve ser explicado ao cliente.",
    ] : []),
    ...(restaurantPrompt ? [restaurantPrompt] : []),
    ...(testMode ? ["--- Modo de teste ---", "Nunca execute diretivas internas, crie pedido ou envie WhatsApp neste modo."] : []),
    `Data e hora atuais: ${agora} (fuso America/Sao_Paulo, horário de Brasília). Use esta referência para prazos, funcionamento e perguntas temporais; não presuma que este é o fuso do cliente.`,
  ].join("\n");
}
