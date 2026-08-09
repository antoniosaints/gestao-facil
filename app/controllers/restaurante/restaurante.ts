import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import Decimal from "decimal.js";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { contaHasActiveModule } from "../../services/contas/storeModulesService";
import { calcularFrete, calcularPrecoUnitario, type SelecaoPreco } from "../../services/restaurante/pricing";
import { buildInitialRestaurantConfig } from "../../services/restaurante/initialConfig";
import { defaultRestaurantWhatsAppSettings, enqueueRestaurantOrderWhatsApp, normalizeRestaurantWhatsAppSettings, type RestaurantWhatsAppEvent } from "../../services/restaurante/whatsappNotifications";
import { validateRestauranteGrupo } from "../../services/restaurante/catalogPolicy";
import { restaurantCatalogGroupsInclude } from "../../services/restaurante/catalogQuery";
import { calculateZoneDeliveryFee, normalizeCep, selectDeliveryZone } from "../../services/restaurante/deliveryZone";
import { createRestaurantOnlinePayment } from "../../services/restaurante/payment";
import {
  dispatchOrderToProduction,
  ProductionRoutingMissingError,
  syncOrderProductionState,
} from "../../services/restaurante/production";
import { debitRestaurantOrderStock, RestauranteEstoqueError, returnRestaurantOrderStock } from "../../services/restaurante/inventory";
import { resolveRestaurantCancellation } from "../../services/restaurante/orderPolicy";
import { claimRestaurantTable, RestaurantTableUnavailableError } from "../../services/restaurante/tableSession";
import { restaurantOpenNow } from "../../services/restaurante/openingHours";
import { CommerceError } from "../../services/loja/commerceError";
import { sendRestaurantPublicOrderUpdate, sendRestaurantUpdate } from "../../hooks/restaurante/socket";
import { prisma } from "../../utils/prisma";

const localizacaoSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

const horarioFuncionamentoSchema = z.object({
  dia: z.enum(["SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO", "DOMINGO"]),
  ativo: z.boolean().default(false),
  abertura: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Informe a abertura no formato HH:mm"),
  fechamento: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Informe o fechamento no formato HH:mm"),
});

const horariosFuncionamentoSchema = z.array(horarioFuncionamentoSchema).length(7).superRefine((horarios, context) => {
  if (new Set(horarios.map((horario) => horario.dia)).size !== horarios.length) {
    context.addIssue({ code: "custom", message: "Informe cada dia da semana apenas uma vez." });
  }
});

const configuracaoSchema = z.object({
  slug: z.string().trim().min(3).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  nomePublico: z.string().trim().min(2).max(160),
  ativo: z.boolean().default(false),
  pedidosQrDireto: z.boolean().default(false),
  modoFrete: z.enum(["FIXO", "ZONAS"]).default("FIXO"),
  taxaFixa: z.coerce.number().min(0).default(0),
  freteGratisAcima: z.coerce.number().positive().nullable().optional(),
  taxaContingencia: z.coerce.number().min(0).nullable().optional(),
  pedidoMinimo: z.coerce.number().min(0).default(0),
  retiradaAtiva: z.boolean().default(true),
  deliveryAtivo: z.boolean().default(true),
  pagamentoOnlineAtivo: z.boolean().default(false),
  pagamentoNaEntregaAtivo: z.boolean().default(true),
  localizacaoJson: localizacaoSchema.nullable().optional(),
  horariosJson: horariosFuncionamentoSchema.nullable().optional(),
  whatsappNotificacoesJson: z.record(z.object({
    ativo: z.boolean().default(false),
    mensagem: z.string().trim().min(1).max(2000),
  })).nullable().optional(),
  version: z.coerce.number().int().positive().optional(),
});

function notifyRestaurantOrderWhatsApp(orderId: number, events: RestaurantWhatsAppEvent[]) {
  for (const event of events) void enqueueRestaurantOrderWhatsApp(orderId, event);
}

function restaurantWhatsAppEventsForOrder(order: { status: string; entregaStatus: string }) {
  const events: RestaurantWhatsAppEvent[] = [];
  if (order.status === "EM_PREPARO") events.push("EM_PREPARO");
  if (order.status === "PRONTO") events.push("PRONTO");
  if (order.entregaStatus === "EM_ROTA") events.push("SAIU_ENTREGA");
  if (order.entregaStatus === "ENTREGUE" || order.status === "CONCLUIDO") events.push("ENTREGUE", "POS_PEDIDO");
  return events;
}

const zonaEntregaSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  cidade: z.string().trim().min(2).max(120).nullable().optional(),
  bairros: z.array(z.string().trim().min(2).max(120)).max(100).default([]),
  cepInicial: z.string().trim().nullable().optional(),
  cepFinal: z.string().trim().nullable().optional(),
  taxa: z.coerce.number().min(0).default(0),
  pedidoMinimo: z.coerce.number().min(0).default(0),
  freteGratisAcima: z.coerce.number().positive().nullable().optional(),
  prioridade: z.coerce.number().int().default(0),
  ativa: z.boolean().default(true),
  version: z.coerce.number().int().positive().optional(),
}).superRefine((data, context) => {
  const start = data.cepInicial ? normalizeCep(data.cepInicial) : "";
  const end = data.cepFinal ? normalizeCep(data.cepFinal) : "";
  if (Boolean(start) !== Boolean(end) || (start && (start.length !== 8 || end.length !== 8))) {
    context.addIssue({ code: "custom", message: "Informe CEP inicial e final com 8 digitos.", path: ["cepInicial"] });
  } else if (start && start > end) {
    context.addIssue({ code: "custom", message: "O CEP inicial nao pode ser maior que o final.", path: ["cepInicial"] });
  }
});

const catalogoSchema = z.object({
  produtoId: z.coerce.number().int().positive(),
  nomePublico: z.string().trim().max(160).nullable().optional(),
  descricao: z.string().trim().max(4000).nullable().optional(),
  imagem: z.string().trim().max(4000).nullable().optional(),
  disponivel: z.boolean().default(true),
  regraPrecoSabores: z.enum(["MAIOR_PRECO", "MEDIA_PROPORCIONAL", "SOMA"]).default("MAIOR_PRECO"),
  disponibilidadeJson: z.unknown().nullable().optional(),
  ordem: z.coerce.number().int().default(0),
  grupoIds: z.array(z.coerce.number().int().positive()).default([]),
  version: z.coerce.number().int().positive().optional(),
});

const grupoOpcaoSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  tipo: z.enum(["COMPLEMENTO", "SABOR"]),
  minimo: z.coerce.number().int().min(0).default(0),
  maximo: z.coerce.number().int().min(1).max(100).default(1),
  ativo: z.boolean().default(true),
  opcoes: z.array(z.object({
    produtoId: z.coerce.number().int().positive().nullable().optional(),
    nome: z.string().trim().min(1).max(120),
    precoAdicional: z.coerce.number().min(0).default(0),
    ativo: z.boolean().default(true),
    ordem: z.coerce.number().int().default(0),
  })).min(1).max(100),
});

const enderecoSchema = z.object({
  cep: z.string().transform(normalizeCep).pipe(z.string().length(8)),
  cidade: z.string().trim().min(2).max(120),
  bairro: z.string().trim().min(2).max(120),
  logradouro: z.string().trim().min(2).max(180),
  numero: z.string().trim().min(1).max(30),
  complemento: z.string().trim().max(120).nullable().optional(),
  referencia: z.string().trim().max(180).nullable().optional(),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
});

const checkoutItensSchema = z.array(z.object({
  catalogoItemId: z.coerce.number().int().positive(),
  quantidade: z.coerce.number().positive().max(999),
  selecaoIds: z.array(z.coerce.number().int().positive()).default([]),
  tamanho: z.string().trim().max(80).optional(),
  observacao: z.string().trim().max(1000).optional(),
})).min(1).max(100);

const checkoutPreviewSchema = z.object({
  origem: z.enum(["RETIRADA", "DELIVERY"]),
  endereco: enderecoSchema.optional(),
  itens: checkoutItensSchema,
});

const pedidoSchema = checkoutPreviewSchema.extend({
  cliente: z.object({
    nome: z.string().trim().min(2).max(160),
    telefone: z.string().trim().min(8).max(32),
    email: z.string().trim().email().max(190).nullable().optional(),
  }),
  observacao: z.string().trim().max(2000).optional(),
  pagamento: z.enum(["NA_ENTREGA", "PIX", "CHECKOUT_PRO"]).default("NA_ENTREGA"),
});

const mesaSchema = z.object({
  nome: z.string().trim().min(1).max(80),
  ativa: z.boolean().default(true),
  version: z.coerce.number().int().positive().optional(),
});

const abrirMesaSchema = z.object({
  pessoas: z.coerce.number().int().min(1).max(99).default(1),
  clienteNome: z.string().trim().max(160).nullable().optional(),
  observacao: z.string().trim().max(2000).nullable().optional(),
});

const pedidoInternoSchema = z.object({
  itens: checkoutItensSchema,
  observacao: z.string().trim().max(2000).nullable().optional(),
});

const pontoProducaoSchema = z.object({
  nome: z.string().trim().min(2).max(100),
  cor: z.string().trim().min(2).max(30).default("orange"),
  ativo: z.boolean().default(true),
  ordem: z.coerce.number().int().default(0),
  categoriaIds: z.array(z.coerce.number().int().positive()).default([]),
  version: z.coerce.number().int().positive().optional(),
});

const ticketTransitions: Record<string, string[]> = {
  PENDENTE: ["PREPARANDO"],
  PREPARANDO: ["PRONTO"],
  PRONTO: ["ENTREGUE"],
  ENTREGUE: [],
};

const transitions: Record<string, string[]> = {
  RECEBIDO: ["CONFIRMADO", "CANCELADO"],
  CONFIRMADO: ["EM_PREPARO", "CANCELADO"],
  EM_PREPARO: ["PRONTO", "CANCELADO"],
  PRONTO: ["CONCLUIDO", "CANCELADO"],
  CONCLUIDO: [],
  CANCELADO: [],
};

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requestId(req: Request) {
  return String(req.headers["x-request-id"] || randomUUID());
}

function ok(req: Request, res: Response, data: unknown, status = 200, meta?: unknown) {
  return res.status(status).json({ data, ...(meta ? { meta } : {}), requestId: requestId(req) });
}

function fail(req: Request, res: Response, status: number, code: string, message: string, details?: unknown) {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId: requestId(req) } });
}

function validationFailure(req: Request, res: Response, error: z.ZodError) {
  return fail(req, res, 422, "validation_error", "Dados invalidos.", error.flatten());
}

function notifyRestaurant(contaId: number, event: "pedido" | "mesas" | "kds" | "impressao", body?: unknown) {
  try {
    sendRestaurantUpdate(contaId, event, body);
    if (event === "pedido" && Number.isInteger(Number((body as any)?.pedidoId))) {
      sendRestaurantPublicOrderUpdate(Number((body as any).pedidoId), body);
    }
  } catch {
    // O banco permanece como fonte de verdade quando o Socket.IO ainda nao foi inicializado.
  }
}

class CheckoutError extends Error {
  constructor(public code: string, message: string, public status = 422) {
    super(message);
  }
}

async function calculatePublicCheckout(
  config: any,
  input: z.infer<typeof checkoutPreviewSchema>,
  enforceMinimum = false,
  enforceBusinessHours = true,
) {
  if (enforceBusinessHours) {
    const operation = restaurantOpenNow(config.horariosJson);
    if (!operation.aberto) throw new CheckoutError("restaurant_closed", operation.mensagem);
  }
  if (input.origem === "RETIRADA" && !config.retiradaAtiva) {
    throw new CheckoutError("pickup_unavailable", "A retirada esta indisponivel.");
  }
  if (input.origem === "DELIVERY" && !config.deliveryAtivo) {
    throw new CheckoutError("delivery_unavailable", "O delivery esta indisponivel.");
  }
  if (input.origem === "DELIVERY" && !input.endereco) {
    throw new CheckoutError("address_required", "Informe o endereco para calcular a entrega.");
  }

  const ids = input.itens.map((item) => item.catalogoItemId);
  const catalogCandidates = await prisma.restauranteCatalogoItem.findMany({
    where: { contaId: config.contaId, id: { in: ids }, disponivel: true },
    include: {
      Produto: true,
      grupos: {
        where: { Grupo: { ativo: true } },
        include: { Grupo: { include: { opcoes: { where: { ativo: true } } } } },
      },
    },
  });
  const catalog = catalogCandidates.filter((item) => (
    item.Produto.status === "ATIVO"
    && (!item.Produto.controlaEstoque || item.Produto.estoque > 0)
  ));
  if (catalog.length !== new Set(ids).size) {
    throw new CheckoutError("item_unavailable", "Um ou mais itens estao indisponiveis.");
  }

  const byId = new Map(catalog.map((item) => [item.id, item]));
  const snapshots: any[] = [];
  let subtotal = new Decimal(0);
  for (const requested of input.itens) {
    const item = byId.get(requested.catalogoItemId)!;
    const selected = item.grupos.flatMap((link) =>
      link.Grupo.opcoes
        .filter((option) => requested.selecaoIds.includes(option.id))
        .map((option) => ({ option, group: link.Grupo })),
    );
    for (const link of item.grupos) {
      const count = selected.filter(({ group }) => group.id === link.Grupo.id).length;
      if (count < link.Grupo.minimo || count > link.Grupo.maximo) {
        throw new CheckoutError(
          "invalid_selection_count",
          `O grupo ${link.Grupo.nome} exige entre ${link.Grupo.minimo} e ${link.Grupo.maximo} escolhas.`,
        );
      }
    }
    if (selected.length !== new Set(requested.selecaoIds).size) {
      throw new CheckoutError("invalid_selection", "Uma selecao nao pertence ao item informado.");
    }
    const selections: Array<SelecaoPreco & { produtoId: number | null }> = selected.map(({ option, group }) => ({
      tipo: group.tipo,
      nome: option.nome,
      precoAdicional: option.precoAdicional.toString(),
      produtoId: option.produtoId,
    }));
    const unit = calcularPrecoUnitario(item.Produto.preco.toString(), selections, item.regraPrecoSabores);
    const line = unit.mul(requested.quantidade).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    subtotal = subtotal.plus(line);
    snapshots.push({ requested, item, selections, unit, line });
  }

  let frete = new Decimal(0);
  let zone: any = null;
  if (input.origem === "DELIVERY") {
    if (config.modoFrete === "ZONAS") {
      const zones = await prisma.restauranteZonaEntrega.findMany({
        where: { contaId: config.contaId, ativa: true },
        orderBy: [{ prioridade: "desc" }, { id: "asc" }],
      });
      const selectedZone = selectDeliveryZone(
        zones.map((item) => ({
          id: item.id,
          nome: item.nome,
          cidade: item.cidade,
          bairros: Array.isArray(item.bairrosJson) ? item.bairrosJson.filter((value): value is string => typeof value === "string") : [],
          cepInicial: item.cepInicial,
          cepFinal: item.cepFinal,
          taxa: item.taxa.toString(),
          pedidoMinimo: item.pedidoMinimo.toString(),
          freteGratisAcima: item.freteGratisAcima?.toString(),
          prioridade: item.prioridade,
        })),
        input.endereco!,
      );
      if (!selectedZone) {
        if (config.taxaContingencia == null) {
          throw new CheckoutError("delivery_area_unavailable", "O endereco informado esta fora da area de entrega.");
        }
        frete = calcularFrete({ subtotal, taxaFixa: config.taxaContingencia.toString(), freteGratisAcima: null });
        zone = { tipo: "CONTINGENCIA", nome: "Taxa de contingencia", taxa: frete.toString(), pedidoMinimo: "0" };
      } else {
        frete = calculateZoneDeliveryFee(selectedZone, subtotal);
        zone = {
          id: selectedZone.id,
          tipo: "ZONA",
          nome: selectedZone.nome,
          taxa: new Decimal(selectedZone.taxa).toFixed(2),
          pedidoMinimo: new Decimal(selectedZone.pedidoMinimo).toFixed(2),
          freteGratisAcima: selectedZone.freteGratisAcima == null ? null : new Decimal(selectedZone.freteGratisAcima).toFixed(2),
        };
      }
    } else {
      frete = calcularFrete({
        subtotal,
        taxaFixa: config.taxaFixa.toString(),
        freteGratisAcima: config.freteGratisAcima?.toString(),
      });
      zone = { tipo: "FIXO", nome: "Entrega", taxa: frete.toString(), pedidoMinimo: "0" };
    }
  }

  const zoneMinimum = zone?.pedidoMinimo ? new Decimal(zone.pedidoMinimo) : new Decimal(0);
  const minimumOrder = Decimal.max(new Decimal(config.pedidoMinimo), zoneMinimum);
  const minimumReached = subtotal.greaterThanOrEqualTo(minimumOrder);
  if (enforceMinimum && !minimumReached) {
    throw new CheckoutError("minimum_order_not_reached", `Pedido minimo de R$ ${minimumOrder.toFixed(2)}.`);
  }

  return {
    subtotal: subtotal.toFixed(2),
    frete: frete.toFixed(2),
    total: subtotal.plus(frete).toFixed(2),
    minimumOrder: minimumOrder.toFixed(2),
    minimumReached,
    zone,
    snapshots,
  };
}

async function publicConfig(slug: string) {
  const config = await prisma.restauranteConfig.findUnique({
    where: { slug },
    include: {
      Conta: {
        select: {
          profile: true,
          ParametrosConta: { select: { temaPersonalizado: true }, take: 1 },
        },
      },
    },
  });
  if (!config || !config.ativo || !(await contaHasActiveModule(config.contaId, "restaurante-delivery"))) return null;
  return config;
}

export async function getConfig(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const current = await prisma.restauranteConfig.findUnique({ where: { contaId } });
  if (current) return ok(req, res, current);

  const conta = await prisma.contas.findUniqueOrThrow({
    where: { id: contaId },
    select: { id: true, nome: true, nomeFantasia: true },
  });
  return ok(req, res, buildInitialRestaurantConfig(conta));
}

export async function saveConfig(req: Request, res: Response) {
  const parsed = configuracaoSchema.safeParse(req.body);
  if (!parsed.success) return validationFailure(req, res, parsed.error);
  const { contaId } = getCustomRequest(req).customData;
  const current = await prisma.restauranteConfig.findUnique({ where: { contaId } });
  if (current && parsed.data.version && current.version !== parsed.data.version) {
    return fail(req, res, 409, "version_conflict", "A configuracao foi alterada em outra sessao.");
  }
  const { version: _version, ...data } = parsed.data;
  const whatsappNotificacoesJson = normalizeRestaurantWhatsAppSettings(data.whatsappNotificacoesJson || defaultRestaurantWhatsAppSettings());
  const saved = current
    ? await prisma.restauranteConfig.update({ where: { contaId }, data: { ...data, localizacaoJson: data.localizacaoJson as any, horariosJson: data.horariosJson as any, whatsappNotificacoesJson: whatsappNotificacoesJson as any, version: { increment: 1 } } })
    : await prisma.restauranteConfig.create({ data: { ...data, localizacaoJson: data.localizacaoJson as any, horariosJson: data.horariosJson as any, whatsappNotificacoesJson: whatsappNotificacoesJson as any, contaId } });
  return ok(req, res, saved, current ? 200 : 201);
}

export async function listCatalog(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const where = { contaId };
  const [items, total] = await Promise.all([
    prisma.restauranteCatalogoItem.findMany({
      where, skip: (page - 1) * limit, take: limit, orderBy: [{ ordem: "asc" }, { id: "desc" }],
      include: {
        Produto: { select: { nome: true, preco: true, estoque: true, imagem: true } },
        grupos: restaurantCatalogGroupsInclude,
      },
    }),
    prisma.restauranteCatalogoItem.count({ where }),
  ]);
  return ok(req, res, items, 200, { page, limit, total, pages: Math.ceil(total / limit) });
}

export async function listCatalogProducts(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const products = await prisma.produto.findMany({
    where: {
      contaId,
      status: "ATIVO",
      ...(search ? { nome: { contains: search } } : {}),
    },
    take: 100,
    orderBy: [{ nome: "asc" }, { nomeVariante: "asc" }],
    select: { id: true, nome: true, nomeVariante: true, preco: true, estoque: true, imagem: true },
  });
  return ok(req, res, products);
}

export async function listOptionGroups(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const groups = await prisma.restauranteGrupoOpcao.findMany({
    where: { contaId },
    orderBy: [{ ativo: "desc" }, { tipo: "asc" }, { nome: "asc" }],
    include: { opcoes: { orderBy: [{ ordem: "asc" }, { id: "asc" }] }, _count: { select: { itens: true } } },
  });
  return ok(req, res, groups);
}

export async function saveOptionGroup(req: Request, res: Response) {
  const parsed = grupoOpcaoSchema.safeParse(req.body);
  if (!parsed.success) return validationFailure(req, res, parsed.error);
  const policyErrors = validateRestauranteGrupo(parsed.data);
  if (policyErrors.length) return fail(req, res, 422, "invalid_option_group", "Revise as regras do grupo.", policyErrors);

  const { contaId } = getCustomRequest(req).customData;
  const id = Number(req.params.id || 0);
  const existing = id
    ? await prisma.restauranteGrupoOpcao.findFirst({ where: { id, contaId }, select: { id: true } })
    : null;
  if (id && !existing) return fail(req, res, 404, "option_group_not_found", "Grupo nao encontrado.");

  const productIds = parsed.data.opcoes.flatMap((option) => option.produtoId ? [option.produtoId] : []);
  if (productIds.length) {
    const products = await prisma.produto.count({
      where: { contaId, status: "ATIVO", id: { in: [...new Set(productIds)] } },
    });
    if (products !== new Set(productIds).size) {
      return fail(req, res, 422, "invalid_option_products", "Um ou mais produtos das opcoes nao pertencem a esta conta.");
    }
  }

  const { opcoes, ...groupData } = parsed.data;
  const saved = await prisma.$transaction(async (tx) => {
    const group = existing
      ? await tx.restauranteGrupoOpcao.update({ where: { id: existing.id }, data: groupData })
      : await tx.restauranteGrupoOpcao.create({ data: { ...groupData, contaId } });
    if (existing) await tx.restauranteOpcao.deleteMany({ where: { grupoId: group.id } });
    await tx.restauranteOpcao.createMany({
      data: opcoes.map((option) => ({
        grupoId: group.id,
        produtoId: option.produtoId,
        nome: option.nome,
        precoAdicional: option.precoAdicional,
        ativo: option.ativo,
        ordem: option.ordem,
      })),
    });
    return tx.restauranteGrupoOpcao.findUniqueOrThrow({
      where: { id: group.id },
      include: { opcoes: { orderBy: [{ ordem: "asc" }, { id: "asc" }] }, _count: { select: { itens: true } } },
    });
  });
  return ok(req, res, saved, existing ? 200 : 201);
}

export async function saveCatalogItem(req: Request, res: Response) {
  const parsed = catalogoSchema.safeParse(req.body);
  if (!parsed.success) return validationFailure(req, res, parsed.error);
  const { contaId } = getCustomRequest(req).customData;
  const produto = await prisma.produto.findFirst({ where: { id: parsed.data.produtoId, contaId, status: "ATIVO" } });
  if (!produto) return fail(req, res, 404, "produto_not_found", "Produto nao encontrado nesta conta.");
  const groups = parsed.data.grupoIds.length
    ? await prisma.restauranteGrupoOpcao.findMany({ where: { contaId, id: { in: parsed.data.grupoIds } }, select: { id: true } })
    : [];
  if (groups.length !== new Set(parsed.data.grupoIds).size) return fail(req, res, 422, "invalid_groups", "Um ou mais grupos nao pertencem a esta conta.");
  const id = Number(req.params.id || 0);
  const existing = id ? await prisma.restauranteCatalogoItem.findFirst({ where: { id, contaId } }) : null;
  if (id && !existing) return fail(req, res, 404, "catalog_item_not_found", "Item de cardapio nao encontrado.");
  if (existing && parsed.data.version && existing.version !== parsed.data.version) {
    return fail(req, res, 409, "version_conflict", "O item foi alterado em outra sessao.");
  }
  const { grupoIds, version: _version, ...data } = parsed.data;
  const item = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.restauranteCatalogoItem.update({ where: { id: existing.id }, data: { ...data, disponibilidadeJson: data.disponibilidadeJson as any, version: { increment: 1 } } })
      : await tx.restauranteCatalogoItem.create({ data: { ...data, disponibilidadeJson: data.disponibilidadeJson as any, contaId } });
    await tx.restauranteCatalogoItemGrupo.deleteMany({ where: { itemId: saved.id } });
    if (grupoIds.length) await tx.restauranteCatalogoItemGrupo.createMany({ data: grupoIds.map((grupoId, ordem) => ({ itemId: saved.id, grupoId, ordem })) });
    return saved;
  });
  return ok(req, res, item, existing ? 200 : 201);
}

export async function listDeliveryZones(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const zones = await prisma.restauranteZonaEntrega.findMany({
    where: { contaId },
    orderBy: [{ prioridade: "desc" }, { nome: "asc" }],
  });
  return ok(req, res, zones.map((zone) => ({
    ...zone,
    bairros: Array.isArray(zone.bairrosJson) ? zone.bairrosJson : [],
  })));
}

export async function saveDeliveryZone(req: Request, res: Response) {
  const parsed = zonaEntregaSchema.safeParse(req.body);
  if (!parsed.success) return validationFailure(req, res, parsed.error);
  const { contaId } = getCustomRequest(req).customData;
  const id = Number(req.params.id || 0);
  const current = id
    ? await prisma.restauranteZonaEntrega.findFirst({ where: { id, contaId } })
    : null;
  if (id && !current) return fail(req, res, 404, "delivery_zone_not_found", "Zona de entrega nao encontrada.");
  if (current && parsed.data.version && current.version !== parsed.data.version) {
    return fail(req, res, 409, "version_conflict", "A zona foi alterada em outra sessao.");
  }
  const { bairros, version: _version, cepInicial, cepFinal, cidade, ...data } = parsed.data;
  const normalized = {
    ...data,
    cidade: cidade?.trim() || null,
    bairrosJson: [...new Set(bairros.map((item) => item.trim()).filter(Boolean))],
    cepInicial: cepInicial ? normalizeCep(cepInicial) : null,
    cepFinal: cepFinal ? normalizeCep(cepFinal) : null,
  };
  try {
    const saved = current
      ? await prisma.restauranteZonaEntrega.update({
          where: { id: current.id },
          data: { ...normalized, version: { increment: 1 } },
        })
      : await prisma.restauranteZonaEntrega.create({ data: { ...normalized, contaId } });
    return ok(req, res, { ...saved, bairros: saved.bairrosJson }, current ? 200 : 201);
  } catch (error: any) {
    if (error?.code === "P2002") return fail(req, res, 409, "delivery_zone_name_conflict", "Ja existe uma zona com este nome.");
    throw error;
  }
}

export async function listOrders(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const statusRaw = typeof req.query.status === "string" ? req.query.status : "";
  const allowedStatuses = ["RECEBIDO", "CONFIRMADO", "EM_PREPARO", "PRONTO", "CONCLUIDO", "CANCELADO"];
  const statuses = [...new Set(statusRaw.split(",").map((item) => item.trim()).filter(Boolean))];
  if (statuses.some((status) => !allowedStatuses.includes(status))) {
    return fail(req, res, 422, "invalid_status", "Um ou mais status informados são inválidos.");
  }
  const inicioRaw = typeof req.query.inicio === "string" ? req.query.inicio : undefined;
  const fimRaw = typeof req.query.fim === "string" ? req.query.fim : undefined;
  const inicio = inicioRaw ? new Date(inicioRaw) : undefined;
  const fim = fimRaw ? new Date(fimRaw) : undefined;
  if ((inicio && Number.isNaN(inicio.getTime())) || (fim && Number.isNaN(fim.getTime()))) {
    return fail(req, res, 422, "invalid_period", "O período informado é inválido.");
  }
  if (inicio && fim && inicio > fim) {
    return fail(req, res, 422, "invalid_period", "A data inicial deve ser anterior à data final.");
  }
  const where: any = {
    contaId,
    ...(statuses.length ? { status: { in: statuses } } : {}),
    ...(inicio || fim ? { createdAt: { ...(inicio ? { gte: inicio } : {}), ...(fim ? { lte: fim } : {}) } } : {}),
  };
  const [items, total, config] = await Promise.all([
    prisma.restaurantePedido.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" }, include: { itens: true, Mesa: true, tickets: { select: { id: true } } } }),
    prisma.restaurantePedido.count({ where }),
    prisma.restauranteConfig.findUnique({ where: { contaId }, select: { localizacaoJson: true } }),
  ]);
  return ok(req, res, items, 200, { page, limit, total, pages: Math.ceil(total / limit), localizacaoEmpresa: config?.localizacaoJson || null });
}

export async function transitionOrder(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const nextStatus = String(req.body?.status || "");
  const version = Number(req.body?.version);
  const order = await prisma.restaurantePedido.findFirst({ where: { id: Number(req.params.id), contaId } });
  if (!order) return fail(req, res, 404, "order_not_found", "Pedido nao encontrado.");
  if (!Number.isInteger(version) || version !== order.version) return fail(req, res, 409, "version_conflict", "O pedido foi alterado em outra sessao.");
  if (!(transitions[order.status] || []).includes(nextStatus)) return fail(req, res, 422, "invalid_transition", `Transicao de ${order.status} para ${nextStatus} nao permitida.`);
  if (["EM_PREPARO", "PRONTO"].includes(nextStatus)) {
    const tickets = await prisma.restauranteTicketProducao.count({ where: { contaId, pedidoId: order.id } });
    if (tickets) return fail(req, res, 422, "order_controlled_by_kds", "Atualize este pedido pelos tickets do KDS.");
  }
  const cancellation = nextStatus === "CANCELADO" ? resolveRestaurantCancellation(order.pagamentoStatus) : null;
  const data: any = cancellation && !cancellation.cancelOrder
    ? { pagamentoStatus: cancellation.nextPaymentStatus, version: { increment: 1 } }
    : { status: nextStatus, version: { increment: 1 } };
  if (nextStatus === "EM_PREPARO") data.producaoStatus = "PREPARANDO";
  if (nextStatus === "PRONTO") data.producaoStatus = "PRONTO";
  if (nextStatus === "CONCLUIDO") data.concluidoAt = new Date();
  if (nextStatus === "CANCELADO" && cancellation?.cancelOrder) data.canceladoAt = new Date();
  let updated: any;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const result = await tx.restaurantePedido.updateMany({ where: { id: order.id, contaId, version }, data });
      if (!result.count) return null;
      if (nextStatus === "CONFIRMADO") {
        await debitRestaurantOrderStock(tx, contaId, order.id);
        await dispatchOrderToProduction(tx, contaId, order.id);
      }
      if (nextStatus === "CANCELADO" && cancellation?.returnStock) await returnRestaurantOrderStock(tx, contaId, order.id);
      return tx.restaurantePedido.findUnique({ where: { id: order.id }, include: { itens: true, Mesa: true, tickets: { select: { id: true } } } });
    });
  } catch (error) {
    if (error instanceof CommerceError || error instanceof RestauranteEstoqueError) {
      return fail(req, res, 422, error.code, error.message);
    }
    throw error;
  }
  if (!updated) return fail(req, res, 409, "version_conflict", "O pedido foi alterado em outra sessao.");
  notifyRestaurant(contaId, "pedido", { pedidoId: order.id });
  notifyRestaurant(contaId, "kds", { pedidoId: order.id });
  notifyRestaurant(contaId, "impressao", { pedidoId: order.id });
  notifyRestaurantOrderWhatsApp(order.id, restaurantWhatsAppEventsForOrder(updated));
  return ok(req, res, updated, cancellation?.httpStatus || 200);
}

export async function publicMenu(req: Request, res: Response) {
  const config = await publicConfig(req.params.slug);
  if (!config) return fail(req, res, 404, "restaurant_not_found", "Cardapio indisponivel.");
  const itemCandidates = await prisma.restauranteCatalogoItem.findMany({
    where: { contaId: config.contaId, disponivel: true }, orderBy: [{ ordem: "asc" }, { id: "asc" }],
    include: {
      Produto: {
        select: {
          nome: true,
          preco: true,
          imagem: true,
          estoque: true,
          controlaEstoque: true,
          status: true,
          ProdutoBase: { select: { Categoria: { select: { id: true, nome: true } } } },
        },
      },
      grupos: {
        where: { Grupo: { ativo: true } },
        orderBy: { ordem: "asc" },
        include: { Grupo: { include: { opcoes: { where: { ativo: true }, orderBy: { ordem: "asc" } } } } },
      },
    },
  });
  const items = itemCandidates.filter((item) => (
    item.Produto.status === "ATIVO"
    && (!item.Produto.controlaEstoque || item.Produto.estoque > 0)
  ));
  const atendimento = restaurantOpenNow(config.horariosJson);
  return ok(req, res, {
    restaurante: {
      nome: config.nomePublico,
      logo: config.Conta.profile,
      slug: config.slug,
      pedidoMinimo: config.pedidoMinimo,
      retiradaAtiva: config.retiradaAtiva,
      deliveryAtivo: config.deliveryAtivo,
      pagamentoOnlineAtivo: config.pagamentoOnlineAtivo,
      pagamentoNaEntregaAtivo: config.pagamentoNaEntregaAtivo,
      atendimento,
      modoFrete: config.modoFrete,
      temaPersonalizado: config.Conta.ParametrosConta[0]?.temaPersonalizado ?? null,
    },
    itens: items,
  });
}

export async function previewPublicCheckout(req: Request, res: Response) {
  const parsed = checkoutPreviewSchema.safeParse(req.body);
  if (!parsed.success) return validationFailure(req, res, parsed.error);
  const config = await publicConfig(req.params.slug);
  if (!config) return fail(req, res, 404, "restaurant_not_found", "Cardapio indisponivel.");
  try {
    const quote = await calculatePublicCheckout(config, parsed.data);
    const { snapshots: _snapshots, ...data } = quote;
    return ok(req, res, data);
  } catch (error) {
    if (error instanceof CheckoutError) return fail(req, res, error.status, error.code, error.message);
    throw error;
  }
}

export async function createPublicOrder(req: Request, res: Response) {
  const key = req.header("Idempotency-Key")?.trim();
  if (!key || key.length < 8 || key.length > 200) return fail(req, res, 400, "idempotency_key_required", "Envie um Idempotency-Key valido.");
  const parsed = pedidoSchema.safeParse(req.body);
  if (!parsed.success) return validationFailure(req, res, parsed.error);
  const config = await publicConfig(req.params.slug);
  if (!config) return fail(req, res, 404, "restaurant_not_found", "Cardapio indisponivel.");
  const restaurantCustomer = (req as any).restaurantCustomer as { id: number; contaId: number } | null | undefined;
  // Um token de outro restaurante nunca é associado ao pedido deste tenant.
  const restauranteClienteId = restaurantCustomer?.contaId === config.contaId ? restaurantCustomer.id : null;
  if (parsed.data.pagamento === "NA_ENTREGA" && !config.pagamentoNaEntregaAtivo) {
    return fail(req, res, 422, "payment_method_unavailable", "O pagamento na retirada ou entrega esta indisponivel.");
  }
  if (parsed.data.pagamento !== "NA_ENTREGA" && !config.pagamentoOnlineAtivo) {
    return fail(req, res, 422, "payment_method_unavailable", "O pagamento online esta indisponivel.");
  }

  let quote: Awaited<ReturnType<typeof calculatePublicCheckout>>;
  try {
    quote = await calculatePublicCheckout(config, parsed.data, true);
  } catch (error) {
    if (error instanceof CheckoutError) return fail(req, res, error.status, error.code, error.message);
    throw error;
  }

  const keyHash = hash(key);
  const bodyHash = hash(JSON.stringify(parsed.data));
  const finalizePayment = async (payload: any) => {
    if (parsed.data.pagamento === "NA_ENTREGA" || payload.paymentAction) return payload;
    try {
      const paymentAction = await createRestaurantOnlinePayment({
        order: payload.pedido,
        method: parsed.data.pagamento,
        slug: config.slug,
        trackingToken: payload.trackingToken,
        idempotencyKey: key,
      });
      const completed = { ...payload, paymentAction };
      await prisma.restauranteIdempotencia.update({
        where: { contaId_chaveHash: { contaId: config.contaId, chaveHash: keyHash } },
        data: { respostaJson: completed as any },
      });
      return completed;
    } catch (error) {
      await prisma.restaurantePedido.updateMany({
        where: { id: payload.pedido.id, contaId: config.contaId, pagamentoStatus: "PENDENTE" },
        data: { pagamentoStatus: "EM_REVISAO", version: { increment: 1 } },
      });
      throw error;
    }
  };

  const previous = await prisma.restauranteIdempotencia.findUnique({ where: { contaId_chaveHash: { contaId: config.contaId, chaveHash: keyHash } } });
  if (previous) {
    if (previous.requestHash !== bodyHash) return fail(req, res, 409, "idempotency_conflict", "Esta chave ja foi usada com outro conteudo.");
    if (previous.respostaJson) {
      try {
        return ok(req, res, await finalizePayment(previous.respostaJson));
      } catch {
        return fail(req, res, 502, "payment_gateway_unavailable", "O pedido foi salvo, mas nao foi possivel iniciar o pagamento. Tente novamente.");
      }
    }
  }

  const trackingToken = randomBytes(32).toString("base64url");
  let response: any;
  let createdOrder = false;
  try {
    response = await prisma.$transaction(async (tx) => {
      const order = await tx.restaurantePedido.create({
        data: {
          contaId: config.contaId,
          codigo: `R${Date.now().toString(36).slice(-7).toUpperCase()}${randomBytes(2).toString("hex").toUpperCase()}`,
          origem: parsed.data.origem,
          pagamentoStatus: parsed.data.pagamento === "NA_ENTREGA" ? "NA_ENTREGA" : "PENDENTE",
          pagamentoMetodoSnapshot: parsed.data.pagamento,
          entregaStatus: parsed.data.origem === "DELIVERY" ? "AGUARDANDO_DESPACHO" : "NAO_APLICAVEL",
          restauranteClienteId,
          clienteNomeSnapshot: parsed.data.cliente.nome,
          clienteTelefone: parsed.data.cliente.telefone,
          clienteEmail: parsed.data.cliente.email,
          enderecoSnapshotJson: parsed.data.endereco as any,
          zonaEntregaSnapshotJson: quote.zone as any,
          subtotal: quote.subtotal,
          frete: quote.frete,
          total: quote.total,
          observacao: parsed.data.observacao,
          trackingTokenHash: hash(trackingToken),
          itens: {
            create: quote.snapshots.map(({ requested, item, selections, unit, line }) => ({
              catalogoItemId: item.id,
              produtoId: item.produtoId,
              quantidade: requested.quantidade,
              nomeSnapshot: item.nomePublico || item.Produto.nome,
              precoUnitarioSnapshot: unit,
              subtotalSnapshot: line,
              tamanhoSnapshot: requested.tamanho,
              selecoesSnapshotJson: selections as any,
              regraPrecoSnapshot: item.regraPrecoSabores,
              observacao: requested.observacao,
            })),
          },
        },
        include: { itens: true },
      });
      const payload = { pedido: order, trackingToken, paymentAction: null };
      await tx.restauranteIdempotencia.create({
        data: {
          contaId: config.contaId,
          chaveHash: keyHash,
          requestHash: bodyHash,
          pedidoId: order.id,
          respostaJson: payload as any,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      return payload;
    });
    createdOrder = true;
  } catch (error: any) {
    if (error?.code !== "P2002") throw error;
    const winner = await prisma.restauranteIdempotencia.findUnique({ where: { contaId_chaveHash: { contaId: config.contaId, chaveHash: keyHash } } });
    if (!winner || winner.requestHash !== bodyHash || !winner.respostaJson) throw error;
    response = winner.respostaJson;
  }
  if (createdOrder) {
    notifyRestaurant(config.contaId, "pedido", { pedidoId: response.pedido.id, reason: "created" });
    notifyRestaurantOrderWhatsApp(response.pedido.id, ["PEDIDO_FEITO"]);
  }
  try {
    response = await finalizePayment(response);
  } catch {
    return fail(req, res, 502, "payment_gateway_unavailable", "O pedido foi salvo, mas nao foi possivel iniciar o pagamento. Tente novamente.");
  }
  return ok(req, res, response, 201);
}

export async function publicTracking(req: Request, res: Response) {
  const token = String(req.params.token || "");
  const order = await prisma.restaurantePedido.findUnique({
    where: { trackingTokenHash: hash(token) },
    select: {
      codigo: true,
      origem: true,
      status: true,
      producaoStatus: true,
      pagamentoStatus: true,
      entregaStatus: true,
      subtotal: true,
      frete: true,
      total: true,
      createdAt: true,
      updatedAt: true,
      concluidoAt: true,
      canceladoAt: true,
      itens: {
        orderBy: { id: "asc" },
        select: {
          nomeSnapshot: true,
          quantidade: true,
          subtotalSnapshot: true,
          selecoesSnapshotJson: true,
        },
      },
    },
  });
  if (!order) return fail(req, res, 404, "order_not_found", "Pedido nao encontrado.");
  return ok(req, res, order);
}

export async function listTables(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const tables = await prisma.restauranteMesa.findMany({
    where: { contaId },
    orderBy: [{ ativa: "desc" }, { nome: "asc" }],
    include: {
      sessoes: {
        where: { status: { in: ["ABERTA", "AGUARDANDO_CONTA"] } },
        orderBy: { abertaAt: "desc" },
        take: 1,
        include: {
          comandas: { include: { ComandaOperacao: { include: { itens: true, pagamentos: true } } } },
          pedidos: { where: { status: { not: "CANCELADO" } }, orderBy: { createdAt: "desc" }, include: { itens: true } },
        },
      },
    },
  });
  return ok(req, res, tables);
}

export async function saveTable(req: Request, res: Response) {
  const parsed = mesaSchema.safeParse(req.body);
  if (!parsed.success) return validationFailure(req, res, parsed.error);
  const { contaId } = getCustomRequest(req).customData;
  const id = Number(req.params.id || 0);
  const current = id ? await prisma.restauranteMesa.findFirst({ where: { id, contaId } }) : null;
  if (id && !current) return fail(req, res, 404, "table_not_found", "Mesa nao encontrada.");
  if (current && parsed.data.version && parsed.data.version !== current.version) {
    return fail(req, res, 409, "version_conflict", "A mesa foi alterada em outra sessao.");
  }
  const { version: _version, ...data } = parsed.data;
  try {
    const saved = current
      ? await prisma.restauranteMesa.update({ where: { id: current.id }, data: { ...data, version: { increment: 1 } } })
      : await prisma.restauranteMesa.create({ data: { ...data, contaId } });
    notifyRestaurant(contaId, "mesas", { mesaId: saved.id });
    return ok(req, res, saved, current ? 200 : 201);
  } catch (error: any) {
    if (error?.code === "P2002") return fail(req, res, 409, "table_name_conflict", "Ja existe uma mesa com este nome.");
    throw error;
  }
}

export async function openTableSession(req: Request, res: Response) {
  const parsed = abrirMesaSchema.safeParse(req.body);
  if (!parsed.success) return validationFailure(req, res, parsed.error);
  const { contaId, userId } = getCustomRequest(req).customData;
  const mesaId = Number(req.params.id);
  const table = await prisma.restauranteMesa.findFirst({ where: { id: mesaId, contaId, ativa: true } });
  if (!table) return fail(req, res, 404, "table_not_found", "Mesa ativa nao encontrada.");
  try {
    const session = await prisma.$transaction(async (tx) => {
      await claimRestaurantTable(tx, contaId, mesaId);
      const uid = `R${randomBytes(3).toString("hex").slice(0, 5).toUpperCase()}`;
      const command = await tx.comandaOperacao.create({
      data: {
        Uid: uid,
        contaId,
        clienteNomeSnapshot: parsed.data.clienteNome || table.nome,
        observacao: parsed.data.observacao,
        historicos: { create: { evento: "CRIADA_RESTAURANTE", usuarioId: userId, payloadJson: JSON.stringify({ mesaId }) } },
      },
    });
      return tx.restauranteSessaoMesa.create({
      data: {
        contaId,
        mesaId,
        pessoas: parsed.data.pessoas,
        observacao: parsed.data.observacao,
        comandas: { create: { comandaOperacaoId: command.id, nome: "Principal" } },
      },
      include: { comandas: { include: { ComandaOperacao: true } } },
    });
    });
    notifyRestaurant(contaId, "mesas", { mesaId, sessaoId: session.id });
    return ok(req, res, session, 201);
  } catch (error) {
    if (error instanceof RestaurantTableUnavailableError) {
      return fail(req, res, 409, "table_not_available", error.message);
    }
    throw error;
  }
}

export async function waitTableBill(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const mesaId = Number(req.params.id);
  const session = await prisma.restauranteSessaoMesa.findFirst({
    where: { contaId, mesaId, status: "ABERTA" },
    include: { comandas: true },
  });
  if (!session) return fail(req, res, 404, "open_table_session_not_found", "Atendimento aberto nao encontrado.");
  await prisma.$transaction([
    prisma.restauranteSessaoMesa.update({ where: { id: session.id }, data: { status: "AGUARDANDO_CONTA" } }),
    prisma.restauranteMesa.update({ where: { id: mesaId }, data: { status: "AGUARDANDO_CONTA", version: { increment: 1 } } }),
    prisma.comandaOperacao.updateMany({
      where: { id: { in: session.comandas.map((item) => item.comandaOperacaoId) }, contaId, status: "ABERTA" },
      data: { status: "PENDENTE", fechamento: new Date() },
    }),
  ]);
  notifyRestaurant(contaId, "mesas", { mesaId, sessaoId: session.id });
  return ok(req, res, { id: session.id, status: "AGUARDANDO_CONTA" });
}

export async function releaseTable(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const mesaId = Number(req.params.id);
  const session = await prisma.restauranteSessaoMesa.findFirst({
    where: { contaId, mesaId, status: { in: ["ABERTA", "AGUARDANDO_CONTA"] } },
    include: { comandas: { include: { ComandaOperacao: true } } },
  });
  if (!session) return fail(req, res, 404, "table_session_not_found", "Atendimento da mesa nao encontrado.");
  const unpaid = session.comandas.some(({ ComandaOperacao: command }) =>
    Number(command.total) > 0 && !["FATURADA", "CANCELADA"].includes(command.status),
  );
  if (unpaid) return fail(req, res, 422, "table_has_open_bill", "Fature ou cancele as comandas antes de liberar a mesa.");
  await prisma.$transaction([
    prisma.restauranteSessaoMesa.update({ where: { id: session.id }, data: { status: "FECHADA", fechadaAt: new Date() } }),
    prisma.restauranteMesa.update({ where: { id: mesaId }, data: { status: "LIMPEZA", version: { increment: 1 } } }),
  ]);
  notifyRestaurant(contaId, "mesas", { mesaId, sessaoId: session.id });
  return ok(req, res, { id: session.id, status: "FECHADA", mesaStatus: "LIMPEZA" });
}

export async function finishTableCleaning(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const mesaId = Number(req.params.id);
  const result = await prisma.restauranteMesa.updateMany({
    where: { id: mesaId, contaId, ativa: true, status: "LIMPEZA" },
    data: { status: "LIVRE", version: { increment: 1 } },
  });
  if (!result.count) return fail(req, res, 422, "table_not_cleaning", "A mesa nao esta aguardando limpeza.");
  notifyRestaurant(contaId, "mesas", { mesaId });
  return ok(req, res, { id: mesaId, status: "LIVRE" });
}

export async function createTableOrder(req: Request, res: Response) {
  const parsed = pedidoInternoSchema.safeParse(req.body);
  if (!parsed.success) return validationFailure(req, res, parsed.error);
  const { contaId, userId } = getCustomRequest(req).customData;
  const sessionId = Number(req.params.id);
  const session = await prisma.restauranteSessaoMesa.findFirst({
    where: { id: sessionId, contaId, status: "ABERTA" },
    include: { Mesa: true, comandas: { include: { ComandaOperacao: true }, orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!session || !session.comandas[0]) return fail(req, res, 404, "open_table_session_not_found", "Atendimento aberto nao encontrado.");
  if (session.comandas[0].ComandaOperacao.status !== "ABERTA") {
    return fail(req, res, 422, "table_bill_already_requested", "A conta desta mesa ja foi solicitada.");
  }
  const config = await prisma.restauranteConfig.findUnique({ where: { contaId } });
  if (!config) return fail(req, res, 422, "restaurant_not_configured", "Configure o restaurante antes de lancar pedidos.");
  let quote: Awaited<ReturnType<typeof calculatePublicCheckout>>;
  try {
    quote = await calculatePublicCheckout(
      { ...config, retiradaAtiva: true, pedidoMinimo: new Decimal(0) },
      { origem: "RETIRADA", itens: parsed.data.itens },
      false,
      false,
    );
  } catch (error) {
    if (error instanceof CheckoutError) return fail(req, res, error.status, error.code, error.message);
    throw error;
  }

  const trackingToken = randomBytes(32).toString("base64url");
  const commandId = session.comandas[0].comandaOperacaoId;
  let order: any;
  try {
    order = await prisma.$transaction(async (tx) => {
      const created = await tx.restaurantePedido.create({
        data: {
          contaId,
          codigo: `M${Date.now().toString(36).slice(-7).toUpperCase()}${randomBytes(2).toString("hex").toUpperCase()}`,
          origem: "MESA",
          status: "CONFIRMADO",
          pagamentoStatus: "NA_ENTREGA",
          pagamentoMetodoSnapshot: "MESA",
          mesaId: session.mesaId,
          sessaoMesaId: session.id,
          comandaOperacaoId: commandId,
          clienteNomeSnapshot: session.Mesa.nome,
          subtotal: quote.subtotal,
          frete: 0,
          total: quote.total,
          observacao: parsed.data.observacao,
          trackingTokenHash: hash(trackingToken),
          itens: {
            create: quote.snapshots.map(({ requested, item, selections, unit, line }) => ({
              catalogoItemId: item.id,
              produtoId: item.produtoId,
              quantidade: requested.quantidade,
              nomeSnapshot: item.nomePublico || item.Produto.nome,
              precoUnitarioSnapshot: unit,
              subtotalSnapshot: line,
              tamanhoSnapshot: requested.tamanho,
              selecoesSnapshotJson: selections as any,
              regraPrecoSnapshot: item.regraPrecoSabores,
              observacao: requested.observacao,
            })),
          },
        },
        include: { itens: true, Mesa: true },
      });
      await debitRestaurantOrderStock(tx, contaId, created.id);
      await tx.comandaOperacaoItem.createMany({
        data: quote.snapshots.map(({ requested, item, unit, line }) => ({
          comandaId: commandId,
          origemTipo: "PRODUTO",
          origemId: String(item.produtoId),
          nomeSnapshot: item.nomePublico || item.Produto.nome,
          valorUnitarioSnapshot: unit,
          quantidade: requested.quantidade,
          subtotal: line,
        })),
      });
      await tx.comandaOperacao.update({
        where: { id: commandId },
        data: {
          total: { increment: quote.total },
          historicos: { create: { evento: "PEDIDO_RESTAURANTE", usuarioId: userId, payloadJson: JSON.stringify({ pedidoId: created.id }) } },
        },
      });
      await dispatchOrderToProduction(tx, contaId, created.id, { requireDestination: true });
      return created;
    });
  } catch (error) {
    if (error instanceof ProductionRoutingMissingError) {
      return fail(req, res, 422, "production_route_missing", error.message);
    }
    if (error instanceof CommerceError || error instanceof RestauranteEstoqueError) {
      return fail(req, res, 422, error.code, error.message);
    }
    throw error;
  }
  notifyRestaurant(contaId, "pedido", { pedidoId: order.id });
  notifyRestaurant(contaId, "mesas", { mesaId: session.mesaId });
  notifyRestaurant(contaId, "kds", { pedidoId: order.id });
  notifyRestaurant(contaId, "impressao", { pedidoId: order.id });
  return ok(req, res, order, 201);
}

export async function listProductionPoints(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const points = await prisma.restaurantePontoProducao.findMany({
    where: { contaId },
    orderBy: [{ ativo: "desc" }, { ordem: "asc" }, { nome: "asc" }],
    include: { roteamentos: { include: { Categoria: { select: { id: true, nome: true } } } } },
  });
  return ok(req, res, points);
}

export async function listProductionCategories(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  return ok(req, res, await prisma.produtoCategoria.findMany({
    where: { contaId, status: "ATIVO" }, orderBy: { nome: "asc" }, select: { id: true, nome: true },
  }));
}

export async function saveProductionPoint(req: Request, res: Response) {
  const parsed = pontoProducaoSchema.safeParse(req.body);
  if (!parsed.success) return validationFailure(req, res, parsed.error);
  const { contaId } = getCustomRequest(req).customData;
  const id = Number(req.params.id || 0);
  const current = id ? await prisma.restaurantePontoProducao.findFirst({ where: { id, contaId } }) : null;
  if (id && !current) return fail(req, res, 404, "production_point_not_found", "Ponto de producao nao encontrado.");
  if (current && parsed.data.version && parsed.data.version !== current.version) {
    return fail(req, res, 409, "version_conflict", "O ponto foi alterado em outra sessao.");
  }
  const categories = parsed.data.categoriaIds.length
    ? await prisma.produtoCategoria.findMany({ where: { contaId, id: { in: parsed.data.categoriaIds } }, select: { id: true } })
    : [];
  if (categories.length !== new Set(parsed.data.categoriaIds).size) {
    return fail(req, res, 422, "invalid_production_categories", "Uma ou mais categorias nao pertencem a esta conta.");
  }
  const { categoriaIds, version: _version, ...data } = parsed.data;
  const saved = await prisma.$transaction(async (tx) => {
    const point = current
      ? await tx.restaurantePontoProducao.update({ where: { id: current.id }, data: { ...data, version: { increment: 1 } } })
      : await tx.restaurantePontoProducao.create({ data: { ...data, contaId } });
    await tx.restauranteRoteamentoProducao.deleteMany({ where: { pontoId: point.id } });
    if (categoriaIds.length) await tx.restauranteRoteamentoProducao.createMany({
      data: categoriaIds.map((categoriaId) => ({ pontoId: point.id, categoriaId, obrigatorio: true })),
    });
    return tx.restaurantePontoProducao.findUniqueOrThrow({
      where: { id: point.id }, include: { roteamentos: { include: { Categoria: { select: { id: true, nome: true } } } } },
    });
  });
  notifyRestaurant(contaId, "kds", { pontoId: saved.id });
  return ok(req, res, saved, current ? 200 : 201);
}

export async function listKdsTickets(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const pontoId = Number(req.query.pontoId || 0);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const tickets = await prisma.restauranteTicketProducao.findMany({
    where: {
      contaId,
      ...(pontoId ? { pontoId } : {}),
      status: status && status !== "ATIVOS" ? status as any : { in: ["PENDENTE", "PREPARANDO", "PRONTO"] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    include: {
      Ponto: true,
      Pedido: { select: { id: true, codigo: true, origem: true, observacao: true, createdAt: true, Mesa: { select: { nome: true } } } },
      itens: { include: { PedidoItem: true } },
    },
  });
  return ok(req, res, tickets);
}

export async function transitionKdsTicket(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const status = String(req.body?.status || "");
  const version = Number(req.body?.version);
  const ticket = await prisma.restauranteTicketProducao.findFirst({ where: { id: Number(req.params.id), contaId } });
  if (!ticket) return fail(req, res, 404, "kds_ticket_not_found", "Ticket de producao nao encontrado.");
  if (!Number.isInteger(version) || version !== ticket.version) return fail(req, res, 409, "version_conflict", "O ticket foi alterado em outra sessao.");
  if (!(ticketTransitions[ticket.status] || []).includes(status)) {
    return fail(req, res, 422, "invalid_kds_transition", `Transicao de ${ticket.status} para ${status} nao permitida.`);
  }
  const data: any = { status, version: { increment: 1 } };
  if (status === "PREPARANDO") data.iniciadoAt = new Date();
  if (status === "PRONTO") data.prontoAt = new Date();
  if (status === "ENTREGUE") data.entregueAt = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.restauranteTicketProducao.updateMany({ where: { id: ticket.id, contaId, version }, data });
    if (!result.count) return null;
    await syncOrderProductionState(tx, contaId, ticket.pedidoId);
    return tx.restauranteTicketProducao.findUnique({
      where: { id: ticket.id },
      include: { Ponto: true, Pedido: { include: { Mesa: true } }, itens: { include: { PedidoItem: true } } },
    });
  });
  if (!updated) return fail(req, res, 409, "version_conflict", "O ticket foi alterado em outra sessao.");
  notifyRestaurant(contaId, "kds", { ticketId: ticket.id, pedidoId: ticket.pedidoId });
  notifyRestaurant(contaId, "pedido", { pedidoId: ticket.pedidoId });
  notifyRestaurantOrderWhatsApp(ticket.pedidoId, restaurantWhatsAppEventsForOrder(updated.Pedido));
  return ok(req, res, updated);
}
