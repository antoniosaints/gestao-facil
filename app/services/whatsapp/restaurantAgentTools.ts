import { createHash, randomBytes } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { prisma } from "../../utils/prisma";
import { contaHasActiveModule } from "../contas/storeModulesService";
import { calculatePublicCheckout, CheckoutError } from "../../controllers/restaurante/restaurante";
import { createRestaurantOnlinePayment, cancelRestaurantPendingPixPayment } from "../restaurante/payment";
import { currentFidelityForPhone } from "../restaurante/loyalty";
import { reservarNumeroPedido } from "../restaurante/orderNumber";
import { enqueueRestaurantOrderWhatsApp } from "../restaurante/whatsappNotifications";
import { sendRestaurantPublicOrderUpdate, sendRestaurantPublicSale, sendRestaurantUpdate } from "../../hooks/restaurante/socket";

const enderecoSchema = z.object({
  cep: z.string().trim().min(8).max(9), cidade: z.string().trim().min(2).max(120), bairro: z.string().trim().min(2).max(120),
  logradouro: z.string().trim().min(2).max(180), numero: z.string().trim().min(1).max(30), complemento: z.string().trim().max(120).nullable().optional(),
  referencia: z.string().trim().max(180).nullable().optional(), latitude: z.coerce.number().min(-90).max(90).nullable().optional(), longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
});
const assistantOrderSchema = z.object({
  origem: z.enum(["RETIRADA", "DELIVERY"]), pagamento: z.enum(["NA_ENTREGA", "PIX"]),
  cliente: z.object({ nome: z.string().trim().min(2).max(160), telefone: z.string().trim().min(8).max(32), email: z.string().trim().email().max(190).nullable().optional() }),
  endereco: enderecoSchema.optional(), observacao: z.string().trim().max(2000).optional(),
  itens: z.array(z.object({ catalogoItemId: z.coerce.number().int().positive(), quantidade: z.coerce.number().positive().max(999), selecaoIds: z.array(z.coerce.number().int().positive()).default([]), tamanho: z.string().trim().max(80).optional(), observacao: z.string().trim().max(1000).optional() })).min(1).max(100),
});

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }

export type RestaurantAssistantContext = { prompt: string; open: boolean } | null;

/** Consulta o cardapio apenas quando a conversa realmente trata de restaurante. */
export async function restaurantAssistantContext(contaId: number): Promise<RestaurantAssistantContext> {
  if (!(await contaHasActiveModule(contaId, "restaurante-delivery"))) return null;
  const config = await prisma.restauranteConfig.findFirst({ where: { contaId, ativo: true } });
  if (!config) return null;
  const { restaurantOpenNow } = await import("../restaurante/openingHours");
  const operation = restaurantOpenNow(config.horariosJson);
  const items = await prisma.restauranteCatalogoItem.findMany({
    where: { contaId, disponivel: true }, orderBy: [{ ordem: "asc" }, { id: "asc" }],
    include: {
      Produto: { select: { nome: true, preco: true, status: true, controlaEstoque: true, estoque: true } },
      grupos: { where: { Grupo: { ativo: true } }, include: { Grupo: { include: { opcoes: { where: { ativo: true }, orderBy: { ordem: "asc" } } } } } },
    },
  });
  const available = items.filter((item) => !item.Produto || (item.Produto.status === "ATIVO" && (!item.Produto.controlaEstoque || item.Produto.estoque > 0))).map((item) => ({
    id: item.id, nome: item.nomePublico || item.Produto?.nome, descricao: item.descricao, preco: (item.Produto?.preco || item.preco).toString(),
    complementos: item.grupos.map((link) => ({ id: link.Grupo.id, nome: link.Grupo.nome, minimo: link.Grupo.minimo, maximo: link.Grupo.maximo, opcoes: link.Grupo.opcoes.map((opcao) => ({ id: opcao.id, nome: opcao.nome, adicional: opcao.precoAdicional.toString() })) })),
  }));
  return { open: operation.aberto, prompt: [
    "--- Ferramentas do Restaurante (dados reais; somente use para assunto de pedido) ---",
    `Funcionamento: ${operation.mensagem}. Retirada: ${config.retiradaAtiva ? "sim" : "não"}. Delivery: ${config.deliveryAtivo ? "sim" : "não"}. Pix: ${config.pagamentoOnlineAtivo ? "sim" : "não"}.`,
    "Cardápio e complementos (use os IDs somente na ação interna):", JSON.stringify(available),
    "Para criar pedido, colete e confirme: nome, telefone, retirada/delivery, itens+complementos, pagamento; em delivery colete endereço completo. Nunca invente preço, item, complemento ou disponibilidade.",
    "Somente após o cliente confirmar todos os dados, inclua em uma linha isolada a diretiva interna [[CRIAR_PEDIDO:{JSON}]]. O JSON deve conter origem, pagamento, cliente, endereco quando DELIVERY e itens com catalogoItemId, quantidade, selecaoIds. A diretiva não será mostrada ao cliente.",
  ].join("\n") };
}

/** Executa o mesmo cálculo de itens, adicionais, entrega, mínimo e Pix do checkout público. */
export async function createRestaurantOrderFromAssistant(params: { contaId: number; idempotencyKey: string; draft: unknown }) {
  if (!(await contaHasActiveModule(params.contaId, "restaurante-delivery"))) throw new Error("O módulo Restaurante não está habilitado nesta conta.");
  const input = assistantOrderSchema.parse(params.draft);
  const config = await prisma.restauranteConfig.findFirst({ where: { contaId: params.contaId, ativo: true } });
  if (!config) throw new Error("O cardápio do restaurante está indisponível.");
  if (input.pagamento === "NA_ENTREGA" && !config.pagamentoNaEntregaAtivo) throw new Error("O pagamento na retirada ou entrega está indisponível.");
  if (input.pagamento === "PIX" && !config.pagamentoOnlineAtivo) throw new Error("O pagamento por Pix está indisponível.");
  let quote: Awaited<ReturnType<typeof calculatePublicCheckout>>;
  try { quote = await calculatePublicCheckout(config, input, true); }
  catch (error) { if (error instanceof CheckoutError) throw new Error(error.message); throw error; }

  const fidelity = await currentFidelityForPhone(prisma, params.contaId, input.cliente.telefone);
  const reward = fidelity.program?.ativo && fidelity.progress?.recompensasDisponiveis > 0 ? quote.snapshots.find((snapshot: any) => snapshot.item.id === fidelity.program!.premioCatalogoItemId) : null;
  const discount = reward ? new Decimal(reward.unit).mul(Number(fidelity.program!.descontoPercentual)).div(100).toDecimalPlaces(2) : new Decimal(0);
  if (discount.greaterThan(0)) { quote.total = new Decimal(quote.total).minus(discount).toFixed(2); (quote as any).desconto = discount.toFixed(2); }

  const keyHash = hash(params.idempotencyKey);
  const requestHash = hash(JSON.stringify(input));
  const existing = await prisma.restauranteIdempotencia.findUnique({ where: { contaId_chaveHash: { contaId: params.contaId, chaveHash: keyHash } } });
  if (existing?.requestHash !== undefined && existing.requestHash !== requestHash) throw new Error("A confirmação deste pedido foi alterada. Peça uma nova confirmação ao cliente.");
  let response: any = existing?.respostaJson || null;
  let created = false;
  if (!response) {
    const trackingToken = randomBytes(32).toString("base64url");
    response = await prisma.$transaction(async (tx) => {
      const codigo = await reservarNumeroPedido(tx, params.contaId);
      const pedido = await tx.restaurantePedido.create({ data: {
        contaId: params.contaId, codigo, origem: input.origem, pagamentoStatus: input.pagamento === "PIX" ? "PENDENTE" : "NA_ENTREGA", pagamentoMetodoSnapshot: input.pagamento,
        entregaStatus: input.origem === "DELIVERY" ? "AGUARDANDO_DESPACHO" : "NAO_APLICAVEL", clienteNomeSnapshot: input.cliente.nome, clienteTelefone: input.cliente.telefone, clienteEmail: input.cliente.email,
        enderecoSnapshotJson: input.endereco as any, zonaEntregaSnapshotJson: quote.zone as any, subtotal: quote.subtotal, frete: quote.frete, desconto: (quote as any).desconto || 0, total: quote.total, observacao: input.observacao, trackingTokenHash: hash(trackingToken),
        itens: { create: quote.snapshots.map(({ requested, item, selections, unit, line }) => ({ catalogoItemId: item.id, produtoId: item.produtoId, quantidade: requested.quantidade, nomeSnapshot: item.nomePublico || item.Produto?.nome || "Item do cardápio", precoUnitarioSnapshot: unit, subtotalSnapshot: line, tamanhoSnapshot: requested.tamanho, selecoesSnapshotJson: selections as any, regraPrecoSnapshot: item.regraPrecoSabores, observacao: requested.observacao })) },
      }, include: { itens: true } });
      if (reward && fidelity.normalizedPhone) {
        const claimed = await tx.restauranteFidelidadeProgresso.updateMany({ where: { contaId: params.contaId, telefoneNormalizado: fidelity.normalizedPhone, recompensasDisponiveis: { gt: 0 } }, data: { recompensasDisponiveis: { decrement: 1 } } });
        if (!claimed.count) throw new Error("A recompensa foi usada em outro pedido. Atualize o pedido antes de confirmar.");
      }
      const payload = { pedido, trackingToken, paymentAction: null };
      await tx.restauranteIdempotencia.create({ data: { contaId: params.contaId, chaveHash: keyHash, requestHash, pedidoId: pedido.id, respostaJson: payload as any, expiresAt: new Date(Date.now() + 86_400_000) } });
      return payload;
    });
    created = true;
  }
  if (input.pagamento === "PIX" && !response.paymentAction) {
    try {
      response.paymentAction = await createRestaurantOnlinePayment({ order: response.pedido, method: "PIX", slug: config.slug, trackingToken: response.trackingToken, idempotencyKey: params.idempotencyKey });
      await prisma.restauranteIdempotencia.update({ where: { contaId_chaveHash: { contaId: params.contaId, chaveHash: keyHash } }, data: { respostaJson: response as any } });
    } catch (error) {
      if (created) {
        await cancelRestaurantPendingPixPayment({ contaId: params.contaId, orderId: response.pedido.id }).catch(() => undefined);
        await prisma.$transaction([prisma.cobrancasFinanceiras.deleteMany({ where: { contaId: params.contaId, restaurantePedidoId: response.pedido.id } }), prisma.restaurantePedido.deleteMany({ where: { id: response.pedido.id, contaId: params.contaId, status: "RECEBIDO", pagamentoStatus: "PENDENTE" } }), prisma.restauranteIdempotencia.deleteMany({ where: { contaId: params.contaId, chaveHash: keyHash } })]);
      }
      throw error;
    }
  }
  if (created) {
    sendRestaurantUpdate(params.contaId, "pedido", { pedidoId: response.pedido.id, reason: "created" });
    sendRestaurantPublicOrderUpdate(response.pedido.id, { pedidoId: response.pedido.id, reason: "created" });
    const first = response.pedido.itens[0]; if (first?.nomeSnapshot) sendRestaurantPublicSale(config.slug, { cliente: input.cliente.nome.split(/\s+/)[0] || "Cliente", produto: first.nomeSnapshot });
    void enqueueRestaurantOrderWhatsApp(response.pedido.id, "PEDIDO_FEITO");
  }
  return response;
}
