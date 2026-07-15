import { createHash, randomBytes, randomUUID } from "crypto";
import Decimal from "decimal.js";
import { prisma } from "../../utils/prisma";
import { contaHasActiveModule } from "../contas/storeModulesService";
import { CommerceError } from "./commerceError";
import { ensureLojaConfig } from "./lojaConfigService";
import { consumeOrderReservations, releaseOrderReservations, reserveOrderStock } from "./lojaInventoryService";
import { assertOrderTransition, nextCancellationStatus, reservationDurationMs } from "./lojaOrderPolicy";
import { storeEffectivePrice } from "./lojaPricing";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { generateCobrancaMercadoPago } from "../../controllers/financeiro/mercadoPago/gerarCobranca";
import { generateCobrancaAbacatePay } from "../../controllers/financeiro/abacatePay/gerarCobranca";

export type StoreOrderInput = {
  items: Array<{ productId: number; quantity: number }>;
  channel: "WHATSAPP" | "GATEWAY";
  deliveryType: "RETIRADA" | "ENTREGA_LOCAL";
  customer: {
    name: string;
    email?: string;
    phone: string;
    postalCode?: string;
    address?: string;
    number?: string;
    complement?: string;
    district?: string;
    city?: string;
    state?: string;
  };
  notes?: string;
};

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const stableBodyHash = (value: unknown) => hash(JSON.stringify(value));

async function getStoreBySlug(slug: string) {
  const config = await prisma.lojaVirtualConfig.findUnique({
    where: { slug },
    include: { Conta: { select: { nome: true, nomeFantasia: true, telefone: true } } },
  });
  if (!config) throw new CommerceError("not_found", "Loja não encontrada");
  return config;
}

export async function assertCommerceEnabled(contaId: number) {
  if (!(await contaHasActiveModule(contaId, "loja-virtual"))) {
    throw new CommerceError("commerce_module_inactive", "O módulo Loja Virtual não está ativo");
  }
}

function validateCheckout(config: Awaited<ReturnType<typeof getStoreBySlug>>, input: StoreOrderInput) {
  if (input.items.length === 0) throw new CommerceError("validation_failed", "O carrinho está vazio");
  if (input.channel === "WHATSAPP" && !config.pedidoWhatsapp) {
    throw new CommerceError("validation_failed", "Pedidos por WhatsApp não estão habilitados");
  }
  if (input.channel === "GATEWAY" && (!config.pagamentoOnline || !config.gatewayPreferido)) {
    throw new CommerceError("gateway_unavailable", "Pagamento online indisponível nesta loja");
  }
  if (input.deliveryType === "RETIRADA" && !config.retiradaAtiva) {
    throw new CommerceError("validation_failed", "Retirada não está habilitada");
  }
  if (input.deliveryType === "ENTREGA_LOCAL") {
    if (!config.entregaLocalAtiva) throw new CommerceError("validation_failed", "Entrega local não está habilitada");
    const required = [input.customer.postalCode, input.customer.address, input.customer.number, input.customer.district, input.customer.city, input.customer.state];
    if (required.some((value) => !value?.trim())) {
      throw new CommerceError("validation_failed", "Informe o endereço completo para entrega local");
    }
  }
}

async function calculateOrder(contaId: number, config: Awaited<ReturnType<typeof getStoreBySlug>>, input: StoreOrderInput) {
  const quantities = new Map<number, number>();
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new CommerceError("validation_failed", "Quantidade inválida");
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }
  const productIds = [...quantities.keys()];
  const products = await prisma.produto.findMany({
    where: { contaId, id: { in: productIds }, status: "ATIVO", mostrarNoCatalogo: true },
    include: { ProdutoBase: true },
  });
  if (products.length !== productIds.length) throw new CommerceError("validation_failed", "Um ou mais produtos não estão disponíveis");

  const items = products.map((product) => {
    const quantity = quantities.get(product.id)!;
    // Respeita a promoção ativa: o cliente paga o preço promocional que viu na vitrine.
    const unitPrice = storeEffectivePrice(product);
    return {
      product,
      quantity,
      unitPrice,
      subtotal: unitPrice.mul(quantity),
    };
  });
  for (const item of items) {
    if (!item.product.controlaEstoque) continue;
    const reserved = await prisma.lojaReservaEstoque.aggregate({ where: { contaId, produtoId: item.product.id, status: { in: ["ATIVA", "CONFIRMADA"] } }, _sum: { quantidade: true } });
    const available = Math.max(0, item.product.estoque - (reserved._sum.quantidade ?? 0));
    if (available < item.quantity) throw new CommerceError("stock_unavailable", `${item.product.nome} não possui estoque suficiente`, { produtoId: item.product.id, requested: item.quantity, available });
  }
  const subtotal = items.reduce((total, item) => total.plus(item.subtotal), new Decimal(0));
  let freight = input.deliveryType === "ENTREGA_LOCAL" ? new Decimal(config.taxaEntrega) : new Decimal(0);
  if (config.freteGratisAcima !== null && subtotal.greaterThanOrEqualTo(config.freteGratisAcima)) freight = new Decimal(0);
  return { items, subtotal, freight, total: subtotal.plus(freight) };
}

export async function previewStoreOrder(slug: string, input: StoreOrderInput) {
  const config = await getStoreBySlug(slug);
  await assertCommerceEnabled(config.contaId);
  validateCheckout(config, input);
  const calculated = await calculateOrder(config.contaId, config, input);
  return {
    items: calculated.items.map(({ product, quantity, unitPrice, subtotal }) => ({
      productId: product.id,
      name: product.ProdutoBase?.nome ?? product.nome,
      variant: product.nomeVariante,
      quantity,
      unitPrice: unitPrice.toNumber(),
      subtotal: subtotal.toNumber(),
    })),
    subtotal: calculated.subtotal.toNumber(),
    freight: calculated.freight.toNumber(),
    total: calculated.total.toNumber(),
  };
}

// Número de WhatsApp que recebe o pedido: usa o telefone da conta e, se ausente,
// o WhatsApp cadastrado no rodapé da loja (themeConfig.company.whatsapp).
function resolveStoreWhatsapp(config: Awaited<ReturnType<typeof getStoreBySlug>>): string | null {
  const company = (config.themeConfig as any)?.company;
  return config.Conta.telefone || company?.whatsapp || null;
}

function whatsappAction(phone: string | null, order: any) {
  if (!phone) throw new CommerceError("gateway_unavailable", "WhatsApp da empresa não configurado");
  const delivery = order.tipoEntrega === "RETIRADA" ? "Retirada" : `Entrega: ${order.enderecoSnapshot}, ${order.numeroSnapshot} - ${order.bairroSnapshot}, ${order.cidadeSnapshot}/${order.estadoSnapshot} - CEP ${order.cepSnapshot}`;
  const lines = [
    `Olá! Quero confirmar o pedido ${order.Uid}.`,
    `Cliente: ${order.nomeSnapshot}`,
    ...order.itens.map((item: any) => `• ${item.produtoNomeSnapshot}${item.varianteNomeSnapshot ? ` / ${item.varianteNomeSnapshot}` : ""} — ${item.quantidade} x R$ ${Number(item.precoUnitarioSnapshot).toFixed(2)}`),
    `Total: R$ ${Number(order.total).toFixed(2)}`,
    delivery,
  ];
  const digits = phone.replace(/\D/g, "");
  return { type: "WHATSAPP", url: `https://wa.me/${digits}?text=${encodeURIComponent(lines.join("\n"))}` };
}

async function createOnlineCheckout(order: any, idempotencyKey: string) {
  const attempt = await prisma.lojaCheckoutTentativa.upsert({
    where: { contaId_idempotencyKey: { contaId: order.contaId, idempotencyKey } },
    create: { contaId: order.contaId, pedidoId: order.id, gateway: order.gateway, idempotencyKey },
    update: {},
  });
  if (attempt.status === "PRONTO" && attempt.checkoutUrl) return { type: "REDIRECT", url: attempt.checkoutUrl };

  try {
    const body = { type: "LINK" as const, value: Number(order.total), gateway: order.gateway === "MERCADOPAGO" ? "mercadopago" as const : "abacatepay" as const, clienteId: order.clienteId ?? undefined };
    const generated = order.gateway === "MERCADOPAGO"
      ? await (async () => {
          const parameters = await prisma.parametrosConta.findUnique({ where: { contaId: order.contaId } });
          if (!parameters) throw new Error("Credenciais do Mercado Pago não configuradas");
          return generateCobrancaMercadoPago(body, parameters);
        })()
      : await generateCobrancaAbacatePay(body, order.contaId);
    if (!generated.chargeId) throw new Error("O gateway não retornou a cobrança persistida");
    await prisma.$transaction([
      prisma.cobrancasFinanceiras.update({ where: { id: generated.chargeId }, data: { pedidoLojaId: order.id } }),
      prisma.lojaCheckoutTentativa.update({
        where: { id: attempt.id },
        data: { status: "PRONTO", checkoutUrl: generated.paymentLink, referenciaExterna: generated.gatewayReference },
      }),
    ]);
    return { type: "REDIRECT", url: generated.paymentLink };
  } catch (error) {
    await prisma.lojaCheckoutTentativa.update({
      where: { id: attempt.id },
      data: { status: "FALHOU", erro: error instanceof Error ? error.message : String(error) },
    });
    throw new CommerceError("gateway_unavailable", "Não foi possível iniciar o pagamento", error instanceof Error ? error.message : error);
  }
}

export async function placeStoreOrder(slug: string, input: StoreOrderInput, idempotencyKey: string, lojaClienteId?: number) {
  if (!idempotencyKey?.trim()) throw new CommerceError("validation_failed", "Idempotency-Key é obrigatório");
  const config = await getStoreBySlug(slug);
  await assertCommerceEnabled(config.contaId);
  validateCheckout(config, input);
  if (!lojaClienteId && !config.permitirCheckoutVisitante) throw new CommerceError("unauthorized", "Entre na sua conta para finalizar o pedido");
  const authenticatedCustomer = lojaClienteId
    ? await prisma.lojaCliente.findFirst({
        where: { id: lojaClienteId, contaId: config.contaId },
        select: { id: true, clienteId: true },
      })
    : null;
  if (lojaClienteId && !authenticatedCustomer) {
    throw new CommerceError("unauthorized", "A sessão do cliente pertence a outra loja");
  }
  const requestHash = stableBodyHash(input);

  const existing = await prisma.lojaIdempotencia.findUnique({
    where: { contaId_escopo_chave: { contaId: config.contaId, escopo: "placeOrder", chave: idempotencyKey } },
  });
  if (existing) {
    if (existing.requestHash !== requestHash) throw new CommerceError("idempotency_key_reused", "A chave já foi usada com outro conteúdo");
    if (existing.recursoId) {
      const order = await prisma.lojaPedido.findFirstOrThrow({ where: { contaId: config.contaId, publicId: existing.recursoId }, include: { itens: true } });
      const nextAction = order.canal === "WHATSAPP" ? whatsappAction(resolveStoreWhatsapp(config), order) : await createOnlineCheckout(order, `${idempotencyKey}:checkout`);
      return { order, accessToken: null, nextAction, replayed: true };
    }
  }

  const calculated = await calculateOrder(config.contaId, config, input);
  const accessToken = randomBytes(32).toString("base64url");
  const publicId = randomUUID();
  const expiresAt = new Date(Date.now() + reservationDurationMs(input.channel));
  const order = await prisma.$transaction(async (tx) => {
    await tx.lojaIdempotencia.create({
      data: { contaId: config.contaId, escopo: "placeOrder", chave: idempotencyKey, requestHash, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) },
    });
    const created = await tx.lojaPedido.create({
      data: {
        contaId: config.contaId,
        publicId,
        accessTokenHash: hash(accessToken),
        Uid: gerarIdUnicoComMetaFinal("PED"),
        clienteLojaId: lojaClienteId,
        clienteId: authenticatedCustomer?.clienteId,
        canal: input.channel,
        gateway: input.channel === "GATEWAY" ? config.gatewayPreferido : null,
        pagamentoStatus: input.channel === "GATEWAY" ? "PENDENTE" : "NAO_APLICAVEL",
        tipoEntrega: input.deliveryType,
        nomeSnapshot: input.customer.name,
        emailSnapshot: input.customer.email,
        telefoneSnapshot: input.customer.phone,
        cepSnapshot: input.customer.postalCode,
        enderecoSnapshot: input.customer.address,
        numeroSnapshot: input.customer.number,
        complementoSnapshot: input.customer.complement,
        bairroSnapshot: input.customer.district,
        cidadeSnapshot: input.customer.city,
        estadoSnapshot: input.customer.state,
        subtotal: calculated.subtotal,
        frete: calculated.freight,
        total: calculated.total,
        observacao: input.notes,
        reservaExpiraEm: expiresAt,
      },
    });
    const reservationItems: Array<{ produtoId: number; pedidoItemId: number; quantidade: number; controlaEstoque: boolean }> = [];
    for (const item of calculated.items) {
      const createdItem = await tx.lojaPedidoItem.create({
        data: {
          contaId: config.contaId,
          pedidoId: created.id,
          produtoId: item.product.id,
          produtoNomeSnapshot: item.product.ProdutoBase?.nome ?? item.product.nome,
          varianteNomeSnapshot: item.product.nomeVariante,
          skuSnapshot: item.product.codigoProduto ?? item.product.codigo,
          imagemSnapshot: item.product.imagem,
          unidadeSnapshot: item.product.unidade,
          precoUnitarioSnapshot: item.unitPrice,
          quantidade: item.quantity,
          subtotal: item.subtotal,
          controlaEstoque: item.product.controlaEstoque ?? false,
        },
      });
      reservationItems.push({ produtoId: item.product.id, pedidoItemId: createdItem.id, quantidade: item.quantity, controlaEstoque: item.product.controlaEstoque ?? false });
    }
    await reserveOrderStock(tx, config.contaId, created.id, reservationItems, expiresAt);
    await tx.lojaIdempotencia.update({
      where: { contaId_escopo_chave: { contaId: config.contaId, escopo: "placeOrder", chave: idempotencyKey } },
      data: { recursoTipo: "LojaPedido", recursoId: publicId, responseCode: 201 },
    });
    return tx.lojaPedido.findUniqueOrThrow({ where: { id: created.id }, include: { itens: true } });
  });

  const nextAction = input.channel === "WHATSAPP" ? whatsappAction(resolveStoreWhatsapp(config), order) : await createOnlineCheckout(order, `${idempotencyKey}:checkout`);
  return { order, accessToken, nextAction, replayed: false };
}

export async function retryStoreCheckout(slug: string, publicId: string, accessToken: string, idempotencyKey: string) {
  const config = await getStoreBySlug(slug);
  await assertCommerceEnabled(config.contaId);
  const order = await prisma.lojaPedido.findFirst({ where: { contaId: config.contaId, publicId }, include: { itens: true } });
  if (!order) throw new CommerceError("not_found", "Pedido não encontrado");
  if (order.accessTokenHash !== hash(accessToken)) throw new CommerceError("unauthorized", "Token do pedido inválido");
  if (order.status !== "RECEBIDO" || (order.reservaExpiraEm && order.reservaExpiraEm <= new Date())) {
    throw new CommerceError("invalid_order_transition", "Este pedido não pode mais retomar o checkout");
  }
  return order.canal === "WHATSAPP" ? whatsappAction(resolveStoreWhatsapp(config), order) : createOnlineCheckout(order, `${idempotencyKey}:retry`);
}

export async function getPublicOrder(slug: string, publicId: string, accessToken: string, lojaClienteId?: number) {
  const config = await getStoreBySlug(slug);
  const order = await prisma.lojaPedido.findFirst({ where: { contaId: config.contaId, publicId }, include: { itens: true } });
  if (!order) throw new CommerceError("not_found", "Pedido não encontrado");
  if (order.clienteLojaId ? order.clienteLojaId !== lojaClienteId : order.accessTokenHash !== hash(accessToken)) {
    throw new CommerceError("unauthorized", "Acesso ao pedido não autorizado");
  }
  return order;
}

export async function transitionStoreOrder(contaId: number, orderId: number, action: "confirmar" | "preparar" | "despachar" | "cancelar" | "concluir", idempotencyKey: string) {
  if (!idempotencyKey?.trim()) throw new CommerceError("validation_failed", "Idempotency-Key é obrigatório");
  return prisma.$transaction(async (tx) => {
    const order = await tx.lojaPedido.findFirst({ where: { id: orderId, contaId }, include: { itens: true } });
    if (!order) throw new CommerceError("not_found", "Pedido não encontrado");
    const scope = `order:${orderId}:${action}`;
    const existingIdempotency = await tx.lojaIdempotencia.findUnique({ where: { contaId_escopo_chave: { contaId, escopo: scope, chave: idempotencyKey } } });
    if (existingIdempotency?.responseCode) return order;
    await tx.lojaIdempotencia.create({ data: { contaId, escopo: scope, chave: idempotencyKey, requestHash: stableBodyHash({ orderId, action }), recursoTipo: "LojaPedido", recursoId: String(orderId), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
    const target = action === "confirmar" ? "CONFIRMADO" : action === "preparar" ? "PREPARANDO" : action === "despachar" ? "DESPACHADO" : action === "concluir" ? "CONCLUIDO" : nextCancellationStatus(order.pagamentoStatus);
    assertOrderTransition(order.status, target);

    if (action === "cancelar") {
      if (target === "CANCELADO") await releaseOrderReservations(tx, contaId, order.id);
      const result = await tx.lojaPedido.update({ where: { id: order.id }, data: { status: target as any, canceladoEm: target === "CANCELADO" ? new Date() : null } });
      await tx.lojaIdempotencia.update({ where: { contaId_escopo_chave: { contaId, escopo: scope, chave: idempotencyKey } }, data: { responseCode: 200 } }); return result;
    }
    if (action === "confirmar") {
      await tx.lojaReservaEstoque.updateMany({ where: { contaId, pedidoId: order.id, status: "ATIVA" }, data: { status: "CONFIRMADA", expiresAt: null } });
      const result = await tx.lojaPedido.update({ where: { id: order.id }, data: { status: "CONFIRMADO", confirmadoEm: new Date(), reservaExpiraEm: null } });
      await tx.lojaIdempotencia.update({ where: { contaId_escopo_chave: { contaId, escopo: scope, chave: idempotencyKey } }, data: { responseCode: 200 } }); return result;
    }
    if (action === "despachar") {
      if (order.vendaId) { await tx.lojaIdempotencia.update({ where: { contaId_escopo_chave: { contaId, escopo: scope, chave: idempotencyKey } }, data: { responseCode: 200 } }); return order; }
      const paid = order.pagamentoStatus === "PAGO";
      const sale = await tx.vendas.create({
        data: {
          contaId,
          Uid: gerarIdUnicoComMetaFinal("VEN"),
          valor: order.total,
          clienteId: order.clienteId,
          status: paid ? "FATURADO" : "PENDENTE",
          faturado: paid,
          observacoes: `Pedido da loja ${order.Uid}`,
          ItensVendas: { create: order.itens.map((item) => ({ itemName: `${item.produtoNomeSnapshot}${item.varianteNomeSnapshot ? ` / ${item.varianteNomeSnapshot}` : ""}`, produtoId: item.produtoId, quantidade: item.quantidade, valor: item.precoUnitarioSnapshot })) },
          PagamentoVendas: { create: { metodo: paid ? "GATEWAY" : "OUTRO", valor: order.total, status: paid ? "EFETIVADO" : "PENDENTE", data: paid ? order.pagoEm ?? new Date() : null } },
        },
      });
      await consumeOrderReservations(tx, contaId, order.id, sale.id);
      const result = await tx.lojaPedido.update({ where: { id: order.id }, data: { status: "DESPACHADO", vendaId: sale.id, despachadoEm: new Date() } });
      await tx.lojaIdempotencia.update({ where: { contaId_escopo_chave: { contaId, escopo: scope, chave: idempotencyKey } }, data: { responseCode: 200 } }); return result;
    }
    const result = await tx.lojaPedido.update({
      where: { id: order.id },
      data: action === "preparar" ? { status: "PREPARANDO", preparandoEm: new Date() } : { status: "CONCLUIDO", concluidoEm: new Date() },
    });
    await tx.lojaIdempotencia.update({ where: { contaId_escopo_chave: { contaId, escopo: scope, chave: idempotencyKey } }, data: { responseCode: 200 } }); return result;
  });
}

// Exclusão de pedido: permitida apenas para pedidos "mortos" (cancelados ou expirados),
// que não geraram venda. Os filhos (itens, reservas, tentativas) caem por cascade no banco;
// cobranças e movimentações apenas se desvinculam (FK SetNull), preservando o histórico financeiro.
const DELETABLE_ORDER_STATUSES = ["CANCELADO", "EXPIRADO"] as const;

export async function removeStoreOrder(contaId: number, orderId: number) {
  const order = await prisma.lojaPedido.findFirst({ where: { id: orderId, contaId }, select: { id: true, status: true } });
  if (!order) throw new CommerceError("not_found", "Pedido não encontrado");
  if (!DELETABLE_ORDER_STATUSES.includes(order.status as any)) {
    throw new CommerceError("invalid_order_transition", "Só é possível excluir pedidos cancelados ou expirados");
  }
  await prisma.lojaPedido.delete({ where: { id: order.id } });
  return { id: order.id };
}

export async function expireStoreReservations(now = new Date()) {
  const candidates = await prisma.lojaPedido.findMany({
    where: { status: "RECEBIDO", pagamentoStatus: { in: ["PENDENTE", "NAO_APLICAVEL"] }, reservaExpiraEm: { lte: now } },
    select: { id: true, contaId: true },
    take: 200,
  });
  let expired = 0;
  for (const candidate of candidates) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.lojaPedido.updateMany({ where: { id: candidate.id, contaId: candidate.contaId, status: "RECEBIDO", reservaExpiraEm: { lte: now } }, data: { status: "EXPIRADO" } });
      if (updated.count === 0) return;
      await releaseOrderReservations(tx, candidate.contaId, candidate.id, "EXPIRADA");
      expired += 1;
    });
  }
  return expired;
}

export async function applyStorePaymentEvent(args: {
  contaId: number;
  pedidoId: number;
  provider: "MERCADOPAGO" | "ABACATEPAY";
  eventId: string;
  paid: boolean;
  refunded?: boolean;
  payload?: unknown;
}) {
  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.lojaWebhookEvento.findUnique({
      where: { contaId_provider_eventId: { contaId: args.contaId, provider: args.provider, eventId: args.eventId } },
    });
    if (duplicate?.processedAt) return { duplicate: true };
    const event = duplicate ?? await tx.lojaWebhookEvento.create({
      data: { contaId: args.contaId, provider: args.provider, eventId: args.eventId, payload: args.payload as any },
    });
    const order = await tx.lojaPedido.findFirst({ where: { id: args.pedidoId, contaId: args.contaId } });
    if (!order) throw new CommerceError("not_found", "Pedido da cobrança não encontrado");

    if (args.refunded) {
      await tx.lojaPedido.update({ where: { id: order.id }, data: { pagamentoStatus: "ESTORNADO", status: order.status === "CANCELAMENTO_PENDENTE" ? "CANCELADO" : order.status, canceladoEm: order.status === "CANCELAMENTO_PENDENTE" ? new Date() : order.canceladoEm } });
      await releaseOrderReservations(tx, args.contaId, order.id);
    } else if (args.paid) {
      const expired = order.status === "EXPIRADO" || (order.reservaExpiraEm !== null && order.reservaExpiraEm <= new Date());
      if (expired) {
        await tx.lojaPedido.update({ where: { id: order.id }, data: { status: "REVISAO", pagamentoStatus: "REVISAO", pagoEm: new Date() } });
      } else {
        await tx.lojaReservaEstoque.updateMany({ where: { contaId: args.contaId, pedidoId: order.id, status: "ATIVA" }, data: { status: "CONFIRMADA", expiresAt: null } });
        await tx.lojaPedido.update({ where: { id: order.id }, data: { status: order.status === "RECEBIDO" ? "CONFIRMADO" : order.status, pagamentoStatus: "PAGO", pagoEm: new Date(), confirmadoEm: order.confirmadoEm ?? new Date(), reservaExpiraEm: null } });
      }
    }
    await tx.lojaWebhookEvento.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return { duplicate: false };
  });
}

export async function ensureAllExistingStoresHaveSlugs() {
  const accounts = await prisma.contas.findMany({ where: { LojaVirtualConfig: null }, select: { id: true } });
  for (const account of accounts) await ensureLojaConfig(account.id);
}
