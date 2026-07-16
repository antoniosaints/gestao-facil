import crypto from "crypto";
import { Prisma, WhatsAppMensagemDirecao, WhatsAppMensagemOrigem, WhatsAppMensagemStatus, WhatsAppMensagemTipo } from "../../../generated";
import { prisma } from "../../utils/prisma";
import { WApiClient } from "./wApiClient";
import { downloadAndDecryptWhatsAppMedia } from "./whatsappMedia";
import { AgentHistoryItem, generateAgentReply, geminiSupportsMime } from "./whatsappAgentAI";
import { iaPlatformService } from "../ia/iaPlatformService";
import { iaUsageService } from "../ia/iaUsageService";
import { sendWhatsAppConversationUpdated, sendWhatsAppMessageCreated } from "../../hooks/whatsapp/socket";

export interface AgentInput {
  nome: string;
  prompt: string;
  modelo?: string;
  ativo?: boolean;
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
} satisfies Prisma.WhatsAppConversaInclude;

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
      include: { instancias: { select: { instanciaId: true } } },
    });
    return agents.map(publicAgent);
  },

  async getAgent(contaId: number, id: number) {
    const agent = await prisma.whatsAppAgente.findFirst({
      where: { id, contaId },
      include: { instancias: { select: { instanciaId: true } } },
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
      if (conversa.status !== "PENDENTE" || conversa.atendenteId) return;

      const link = await prisma.whatsAppAgenteInstancia.findUnique({
        where: { contaId_instanciaId: { contaId, instanciaId: instance.id } },
        include: { Agente: true },
      });
      const agent = link?.Agente;
      if (!agent || !agentAttendsNow(agent)) return;

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

      const reply = await generateAgentReply({
        apiKey,
        modelo: agent.modelo,
        systemPrompt: buildSystemPrompt(agent),
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

      if (reply.text?.trim()) {
        await this.sendAgentMessage(contaId, instance, conversa.id, conversa.telefone, reply.text.trim());
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
};

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

function buildSystemPrompt(agent: { nome: string; prompt: string }): string {
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return [
    agent.prompt,
    "",
    "--- Instruções do canal ---",
    `Você é ${agent.nome}, um atendente virtual respondendo pelo WhatsApp.`,
    "Responda de forma curta, cordial e objetiva, como em uma conversa de WhatsApp.",
    "Escreva no mesmo idioma do cliente. Não invente informações que você não tem.",
    "Se o cliente pedir algo que exige um humano, informe que vai encaminhar para um atendente.",
    `Data de hoje: ${hoje}.`,
  ].join("\n");
}
