import { createHash, randomBytes, randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import type { Request, Response } from "express";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { assertAvailableAndDecrement } from "../../services/loja/lojaInventoryService";
import { enqueuePushNotification } from "../../services/pushNotificationQueueService";
import { enqueueWhatsAppNotificationByPreference } from "../../services/notifications/whatsappNotificationQueueService";
import { sendOuriveOrderUpdated } from "../../hooks/ourive/socket";
import { getOuriveAccess } from "../../services/ourive/access";
import {
  calcularFinanceiroOurive,
  dividirRepasseOurives,
} from "../../services/ourive/calculoFinanceiroService";
import { prisma } from "../../utils/prisma";

const db = prisma as any;
const money = (value: unknown) =>
  new Decimal(String(value || 0)).toDecimalPlaces(2);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const requestId = (req: Request) =>
  String(req.headers["x-request-id"] || randomUUID());
const ok = (req: Request, res: Response, data: unknown, status = 200) =>
  res.status(status).json({ data, requestId: requestId(req) });
const fail = (
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
) =>
  res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      requestId: requestId(req),
    },
  });
const own = (req: Request) => getCustomRequest(req).customData;
const stockUnitsForMaterial = (
  _unidade: "QUANTIDADE" | "PESO",
  medida: Decimal.Value,
) => new Decimal(medida).toDecimalPlaces(0).toNumber();
const measureFromStockUnits = (
  _unidade: "QUANTIDADE" | "PESO",
  quantidade: Decimal.Value,
) => new Decimal(quantidade);

const rolesSchema = z.object({
  papeis: z
    .array(z.enum(["GESTOR", "ATENDIMENTO", "OURIVE", "REVISAO"]))
    .max(4),
  especialidadeIds: z.array(z.number().int().positive()).default([]),
});
const orderSchema = z.object({
  tipo: z.enum(["CONSERTO", "ENCOMENDA"]).default("CONSERTO"),
  clienteId: z.preprocess(
    (value) =>
      value === undefined || value === null || value === "" || value === 0 || value === "0"
        ? undefined
        : value,
    z.coerce.number().int().positive().optional(),
  ),
  descricao: z.string().min(3),
  garantia: z.string().default("Sem garantia informada"),
  observacoes: z.string().max(5000).optional(),
  prazoPrevisto: z.coerce.date().optional(),
  pecas: z
    .array(
      z.object({
        descricao: z.string().min(2),
        metal: z.string().optional(),
        pedras: z.string().optional(),
        pesoInformado: z.coerce.number().nonnegative().optional(),
        estadoConservacao: z.string().optional(),
        checklistRecebimento: z.any().optional(),
        fotos: z
          .array(
            z.object({
              url: z.string().url(),
              descricao: z.string().optional(),
            }),
          )
          .default([]),
      }),
    )
    .min(1),
});
const budgetSchema = z.object({
  servicos: z
    .array(
      z.object({
        descricao: z.string().min(2),
        quantidade: z.coerce.number().int().positive().default(1),
        valor: z.coerce.number().nonnegative(),
      }),
    )
    .min(1),
  desconto: z.coerce.number().nonnegative().default(0),
  prazoPrevisto: z.coerce.date().optional(),
  materiais: z
    .array(
      z.object({
        produtoId: z.coerce.number().int().positive(),
        pecaId: z.coerce.number().int().positive().optional(),
        fornecidoPeloCliente: z
          .preprocess(
            (value) => {
              if (value === "true" || value === 1 || value === "1") return true;
              if (value === "false" || value === 0 || value === "0") return false;
              return value;
            },
            z.boolean(),
          )
          .default(false),
        unidade: z.enum(["QUANTIDADE", "PESO"]).default("QUANTIDADE"),
        quantidade: z.coerce.number().positive().max(999_999),
        custoUnitario: z.coerce.number().nonnegative().default(0),
        valorUnitario: z.coerce.number().nonnegative().default(0),
        observacao: z.string().max(2_000).optional(),
      }),
    )
    .default([]),
  custoEstimado: z.coerce.number().nonnegative().default(0),
});
const stageSchema = z.object({
  nome: z.string().min(2),
  especialidadeId: z.number().int().positive().optional(),
  prazoPrevisto: z.coerce.date().optional(),
  observacao: z.string().optional(),
  responsavelIds: z.array(z.number().int().positive()).min(1),
  comissoes: z
    .array(
      z.object({
        usuarioId: z.number().int().positive(),
        tipo: z.enum(["PERCENTUAL", "VALOR_FIXO"]),
        referencia: z.coerce.number().positive(),
      }),
    )
    .default([]),
});

async function orderForAccount(contaId: number, id: number) {
  return db.ouriveOrdem.findFirst({ where: { id, contaId } });
}
async function canAccessOrder(custom: ReturnType<typeof own>, orderId: number) {
  const access = await getOuriveAccess(custom);
  if (
    !access.papeis.includes("OURIVE") ||
    access.capabilities.includes("CONFIGURAR")
  )
    return true;
  const assignments = await db.ouriveEtapaResponsavel.findMany({
    where: { usuarioId: custom.userId },
    select: { etapaId: true },
  });
  return Boolean(
    await db.ouriveEtapa.findFirst({
      where: {
        id: { in: assignments.map((item: any) => item.etapaId) },
        ordemOuriveId: orderId,
      },
    }),
  );
}
async function event(
  tx: any,
  ordemOuriveId: number,
  tipo: string,
  descricao: string,
  autorId?: number,
  dados?: unknown,
) {
  await tx.ouriveEvento.create({
    data: { ordemOuriveId, tipo, descricao, autorId, dados },
  });
}
function notify(contaId: number, title: string, body: string) {
  // Eventos do Ourive são operacionais: apenas administradores devem receber
  // push e WhatsApp. O serviço de WhatsApp também confirma módulo, instância
  // conectada e telefone válido antes de enfileirar cada envio.
  void enqueuePushNotification({ title, body }, contaId, true).catch(
    () => undefined,
  );
  void enqueueWhatsAppNotificationByPreference(
    "NOVA_OS",
    { title, body },
    contaId,
    true,
  ).catch(() => undefined);
}
async function orderDetails(contaId: number, id: number) {
  const order = await db.ouriveOrdem.findFirst({ where: { id, contaId } });
  if (!order) return null;
  const [
    base,
    pecas,
    budgets,
    etapas,
    materiais,
    eventos,
    comissoes,
    movimentacoes,
    necessidadesCompra,
  ] = await Promise.all([
    prisma.ordensServico.findFirst({
      where: { id: order.ordemServicoId, contaId },
      include: {
        Cliente: {
          select: { id: true, nome: true, telefone: true, email: true },
        },
      },
    }),
    db.ourivePeca.findMany({
      where: { ordemOuriveId: id },
      orderBy: { id: "asc" },
    }),
    db.ouriveOrcamento.findMany({
      where: { ordemOuriveId: id },
      orderBy: { versao: "desc" },
    }),
    db.ouriveEtapa.findMany({
      where: { ordemOuriveId: id },
      orderBy: { id: "asc" },
    }),
    db.ouriveMaterial.findMany({
      where: { ordemOuriveId: id },
      orderBy: { id: "asc" },
    }),
    db.ouriveEvento.findMany({
      where: { ordemOuriveId: id },
      orderBy: { createdAt: "desc" },
    }),
    db.ouriveComissao.findMany({
      where: { ordemOuriveId: id },
      orderBy: { id: "asc" },
    }),
    prisma.movimentacoesEstoque.findMany({
      where: { contaId, ordemId: order.ordemServicoId },
      orderBy: { data: "desc" },
      include: { Produto: { select: { id: true, nome: true } } },
    }),
    db.ouriveNecessidadeCompra.findMany({
      where: { ordemOuriveId: id },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const pieceIds = pecas.map((piece: any) => piece.id);
  const stageIds = etapas.map((stage: any) => stage.id);
  const [photos, assignees, products] = await Promise.all([
    db.ourivePecaFoto.findMany({ where: { pecaId: { in: pieceIds } } }),
    db.ouriveEtapaResponsavel.findMany({
      where: { etapaId: { in: stageIds } },
    }),
    prisma.produto.findMany({
      where: { contaId, id: { in: materiais.map((m: any) => m.produtoId) } },
      select: { id: true, nome: true },
    }),
  ]);
  const users = await prisma.usuarios.findMany({
    where: {
      contaId,
      id: {
        in: [
          ...new Set([
            ...assignees.map((a: any) => a.usuarioId),
            ...comissoes.map((c: any) => c.usuarioId),
          ]),
        ],
      },
    },
    select: { id: true, nome: true },
  });
  return {
    ...order,
    ordemServico: base,
    pecas: pecas.map((piece: any) => ({
      ...piece,
      fotos: photos.filter((photo: any) => photo.pecaId === piece.id),
    })),
    orcamentos: budgets,
    etapas: etapas.map((stage: any) => ({
      ...stage,
      responsavelIds: assignees
        .filter((a: any) => a.etapaId === stage.id)
        .map((a: any) => a.usuarioId),
    })),
    materiais: materiais.map((material: any) => ({
      ...material,
      produto: products.find((product) => product.id === material.produtoId),
    })),
    movimentacoes,
    necessidadesCompra: necessidadesCompra.map((need: any) => ({
      ...need,
      produto: products.find((product) => product.id === need.produtoId),
    })),
    comissoes: comissoes.map((commission: any) => ({
      ...commission,
      usuario: users.find((user) => user.id === commission.usuarioId),
    })),
    eventos,
  };
}

export async function currentOuriveAccess(req: Request, res: Response) {
  return ok(req, res, await getOuriveAccess(own(req)));
}
export async function listSpecialties(req: Request, res: Response) {
  const { contaId } = own(req);
  return ok(
    req,
    res,
    await db.ouriveEspecialidade.findMany({
      where: { contaId },
      orderBy: { nome: "asc" },
    }),
  );
}

async function financialCalculationForOrder(contaId: number, order: any) {
  const [budget, materials, config, stages] = await Promise.all([
    db.ouriveOrcamento.findFirst({
      where: { ordemOuriveId: order.id, aprovadoEm: { not: null }, invalidoEm: null },
      orderBy: { versao: "desc" },
    }),
    db.ouriveMaterial.findMany({ where: { ordemOuriveId: order.id } }),
    db.ouriveConfiguracao.upsert({
      where: { contaId },
      create: { contaId },
      update: {},
    }),
    db.ouriveEtapa.findMany({
      where: { ordemOuriveId: order.id },
      select: { id: true },
    }),
  ]);
  if (!budget) throw new Error("budget_not_approved");

  const custoMaterialLoja = materials.reduce((total: Decimal, material: any) => {
    if (material.fornecidoPeloCliente) return total;
    const medida = material.finalizadoEm
      ? new Decimal(material.medidaUtilizada || 0).plus(material.medidaPerdaReal || 0)
      : new Decimal(material.medidaConsumida || material.medidaPlanejada || 0);
    return total.plus(money(material.custoSnapshot || 0).mul(medida));
  }, new Decimal(0));
  const valorMateriaisLoja = materials.reduce(
    (total: Decimal, material: any) =>
      material.fornecidoPeloCliente
        ? total
        : total.plus(money(material.valorUnitario).mul(material.medidaPlanejada || 0)),
    new Decimal(0),
  );
  const memoria = calcularFinanceiroOurive({
    valorBruto: budget.valorFinal,
    custoMaterialLoja,
    outrosCustos: order.custoExtra,
    percentualLoja: order.percentualLojaAplicado ?? config.percentualLoja,
    percentualOurives: order.percentualOurivesAplicado ?? config.percentualOurives,
  });
  const [assignments, products, extraCostEvents] = await Promise.all([
    db.ouriveEtapaResponsavel.findMany({
      where: { etapaId: { in: stages.map((stage: any) => stage.id) } },
      select: { usuarioId: true },
    }),
    prisma.produto.findMany({
      where: { contaId, id: { in: materials.map((material: any) => material.produtoId) } },
      select: { id: true, nome: true },
    }),
    db.ouriveEvento.findMany({
      where: { ordemOuriveId: order.id, tipo: "CUSTO_EXTRA" },
      orderBy: { createdAt: "asc" },
      select: { id: true, descricao: true, dados: true, createdAt: true },
    }),
  ]);
  const materiaisDetalhados = materials.map((material: any) => {
    const medidaCusteada = material.finalizadoEm
      ? new Decimal(material.medidaUtilizada || 0).plus(material.medidaPerdaReal || 0)
      : new Decimal(material.medidaConsumida || material.medidaPlanejada || 0);
    const custoUnitario = material.fornecidoPeloCliente
      ? new Decimal(0)
      : money(material.custoSnapshot || 0);
    return {
      id: material.id,
      nome:
        products.find((product: any) => product.id === material.produtoId)?.nome ||
        `Material #${material.produtoId}`,
      origem: material.fornecidoPeloCliente ? "CLIENTE" : "LOJA",
      unidade: material.unidade,
      medidaCusteada: medidaCusteada.toFixed(3),
      custoUnitario: custoUnitario.toFixed(2),
      custoTotal: money(custoUnitario.mul(medidaCusteada)).toFixed(2),
      valorCobrado: material.fornecidoPeloCliente
        ? "0.00"
        : money(material.valorUnitario || 0)
            .mul(material.medidaPlanejada || 0)
            .toDecimalPlaces(2)
            .toFixed(2),
    };
  });
  const custosExtrasDetalhados = extraCostEvents.map((item: any) => ({
    id: item.id,
    descricao: item.descricao,
    valor: money(item.dados?.valor || 0).toFixed(2),
    createdAt: item.createdAt,
  }));
  const custosExtrasIdentificados = custosExtrasDetalhados.reduce(
    (total: Decimal, item: any) => total.plus(item.valor),
    new Decimal(0),
  );
  const custoExtraSemDetalhe = Decimal.max(
    0,
    money(order.custoExtra).minus(custosExtrasIdentificados),
  );
  if (custoExtraSemDetalhe.greaterThan(0))
    custosExtrasDetalhados.push({
      id: "saldo-anterior",
      descricao: "Custos extras anteriores sem descrição individual",
      valor: custoExtraSemDetalhe.toFixed(2),
      createdAt: null,
    });
  const custoTotalOperacional = money(custoMaterialLoja).plus(money(order.custoExtra));
  const custoTotalComRepasses = custoTotalOperacional.plus(memoria.valorOurives);
  const lucroLiquido = money(budget.valorFinal).minus(custoTotalComRepasses);
  const margemLiquida = money(budget.valorFinal).greaterThan(0)
    ? lucroLiquido.mul(100).div(money(budget.valorFinal))
    : new Decimal(0);
  const retornoSobreCusto = custoTotalComRepasses.greaterThan(0)
    ? lucroLiquido.mul(100).div(custoTotalComRepasses)
    : new Decimal(0);
  return {
    budget,
    materials,
    config,
    memoria,
    responsavelIds: [...new Set(assignments.map((item: any) => Number(item.usuarioId)))],
    detalhamento: {
      valorCobrado: money(budget.valorFinal).toFixed(2),
      valorMaoObra: money(order.valorMaoObra).toFixed(2),
      valorMateriaisLoja: money(valorMateriaisLoja).toFixed(2),
      custoMaterialLoja: money(custoMaterialLoja).toFixed(2),
      materiaisCliente: materials.filter((material: any) => material.fornecidoPeloCliente).length,
      outrosCustos: money(order.custoExtra).toFixed(2),
      materiais: materiaisDetalhados,
      custosExtras: custosExtrasDetalhados,
      custoTotalOperacional: custoTotalOperacional.toFixed(2),
      repasseOurives: money(memoria.valorOurives).toFixed(2),
      custoTotalComRepasses: custoTotalComRepasses.toFixed(2),
      lucroLiquido: lucroLiquido.toFixed(2),
      margemLiquidaPercentual: margemLiquida.toDecimalPlaces(2).toFixed(2),
      retornoSobreCustoPercentual: retornoSobreCusto.toDecimalPlaces(2).toFixed(2),
    },
  };
}
export async function saveSpecialty(req: Request, res: Response) {
  const parsed = z
    .object({
      id: z.number().int().optional(),
      nome: z.string().min(2),
      descricao: z.string().optional(),
      ativo: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return fail(
      req,
      res,
      422,
      "validation_error",
      "Especialidade invalida.",
      parsed.error.flatten(),
    );
  const { contaId } = own(req);
  const data = {
    nome: parsed.data.nome,
    descricao: parsed.data.descricao,
    ativo: parsed.data.ativo ?? true,
  };
  const result = parsed.data.id
    ? await db.ouriveEspecialidade.updateMany({
        where: { id: parsed.data.id, contaId },
        data,
      })
    : await db.ouriveEspecialidade.create({ data: { contaId, ...data } });
  return ok(req, res, result, parsed.data.id ? 200 : 201);
}
export async function listUsers(req: Request, res: Response) {
  const { contaId } = own(req);
  const [users, roles, links] = await Promise.all([
    prisma.usuarios.findMany({
      where: { contaId },
      select: { id: true, nome: true, email: true, status: true },
      orderBy: { nome: "asc" },
    }),
    db.ouriveUsuarioPapel.findMany({ where: { contaId } }),
    db.ouriveUsuarioEspecialidade.findMany({ where: { contaId } }),
  ]);
  return ok(
    req,
    res,
    users.map((user) => ({
      ...user,
      papeis: roles
        .filter((role: any) => role.usuarioId === user.id)
        .map((role: any) => role.papel),
      especialidadeIds: links
        .filter((link: any) => link.usuarioId === user.id)
        .map((link: any) => link.especialidadeId),
    })),
  );
}
export async function saveUser(req: Request, res: Response) {
  const parsed = rolesSchema.safeParse(req.body);
  if (!parsed.success)
    return fail(
      req,
      res,
      422,
      "validation_error",
      "Vinculo de equipe invalido.",
      parsed.error.flatten(),
    );
  const { contaId } = own(req);
  const usuarioId = Number(req.params.usuarioId);
  if (!(await prisma.usuarios.findFirst({ where: { id: usuarioId, contaId } })))
    return fail(req, res, 404, "user_not_found", "Usuario nao encontrado.");
  const validSpecialties = await db.ouriveEspecialidade.count({
    where: { contaId, id: { in: parsed.data.especialidadeIds } },
  });
  if (validSpecialties !== new Set(parsed.data.especialidadeIds).size)
    return fail(
      req,
      res,
      422,
      "invalid_specialty",
      "Especialidade nao pertence a esta conta.",
    );
  await prisma.$transaction(async (tx) => {
    await (tx as any).ouriveUsuarioPapel.deleteMany({
      where: { contaId, usuarioId },
    });
    await (tx as any).ouriveUsuarioEspecialidade.deleteMany({
      where: { contaId, usuarioId },
    });
    if (parsed.data.papeis.length)
      await (tx as any).ouriveUsuarioPapel.createMany({
        data: [...new Set(parsed.data.papeis)].map((papel) => ({
          contaId,
          usuarioId,
          papel,
        })),
      });
    if (parsed.data.especialidadeIds.length)
      await (tx as any).ouriveUsuarioEspecialidade.createMany({
        data: [...new Set(parsed.data.especialidadeIds)].map(
          (especialidadeId) => ({ contaId, usuarioId, especialidadeId }),
        ),
      });
  });
  return ok(req, res, { usuarioId, ...parsed.data });
}
export async function getConfig(req: Request, res: Response) {
  const { contaId } = own(req);
  return ok(
    req,
    res,
    await db.ouriveConfiguracao.upsert({
      where: { contaId },
      create: { contaId },
      update: {},
    }),
  );
}
export async function saveConfig(req: Request, res: Response) {
  const parsed = z
    .object({
      receitaCategoriaId: z.number().int().positive().nullable().optional(),
      receitaContaFinanceiraId: z
        .number()
        .int()
        .positive()
        .nullable()
        .optional(),
      comissaoCategoriaId: z.number().int().positive().nullable().optional(),
      comissaoContaFinanceiraId: z
        .number()
        .int()
        .positive()
        .nullable()
        .optional(),
      proLaboreCategoriaId: z.number().int().positive().nullable().optional(),
      proLaboreContaFinanceiraId: z.number().int().positive().nullable().optional(),
      prazoAprovacaoDias: z.number().int().min(1).max(30).optional(),
      percentualLoja: z.coerce.number().min(0).max(100).optional(),
      percentualOurives: z.coerce.number().min(0).max(100).optional(),
      percentualPerdaPadrao: z.coerce.number().min(0).max(100).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return fail(
      req,
      res,
      422,
      "validation_error",
      "Configuracao invalida.",
      parsed.error.flatten(),
    );
  const { contaId } = own(req);
  const current = await db.ouriveConfiguracao.findUnique({ where: { contaId } });
  const percentualLoja = Number(
    parsed.data.percentualLoja ?? current?.percentualLoja ?? 50,
  );
  const percentualOurives = Number(
    parsed.data.percentualOurives ?? current?.percentualOurives ?? 50,
  );
  if (Math.abs(percentualLoja + percentualOurives - 100) > 0.000_001)
    return fail(
      req,
      res,
      422,
      "invalid_percentage_split",
      "Os percentuais da loja e do ourives devem somar 100%.",
    );
  const categoryIds = [
    parsed.data.receitaCategoriaId,
    parsed.data.comissaoCategoriaId,
    parsed.data.proLaboreCategoriaId,
  ].filter((value): value is number => Boolean(value));
  const accountIds = [
    parsed.data.receitaContaFinanceiraId,
    parsed.data.comissaoContaFinanceiraId,
    parsed.data.proLaboreContaFinanceiraId,
  ].filter((value): value is number => Boolean(value));
  const [categories, accounts] = await Promise.all([
    prisma.categoriaFinanceiro.count({
      where: { contaId, id: { in: categoryIds } },
    }),
    prisma.contasFinanceiro.count({
      where: { contaId, id: { in: accountIds } },
    }),
  ]);
  if (
    categories !== new Set(categoryIds).size ||
    accounts !== new Set(accountIds).size
  )
    return fail(
      req,
      res,
      422,
      "invalid_financial_config",
      "Categoria ou conta financeira nao pertence a esta conta.",
    );
  return ok(
    req,
    res,
    await db.ouriveConfiguracao.upsert({
      where: { contaId },
      create: {
        contaId,
        ...parsed.data,
        percentualLoja,
        percentualOurives,
        percentualPerdaPadrao: parsed.data.percentualPerdaPadrao ?? 10,
      },
      update: {
        ...parsed.data,
        percentualLoja,
        percentualOurives,
      },
    }),
  );
}

export async function createOrder(req: Request, res: Response) {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success)
    return fail(
      req,
      res,
      422,
      "validation_error",
      "Dados da ordem invalidos.",
      parsed.error.flatten(),
    );
  const custom = own(req);
  const client = parsed.data.clienteId
    ? await prisma.clientesFornecedores.findFirst({
        where: { id: parsed.data.clienteId, contaId: custom.contaId },
      })
    : null;
  if (parsed.data.clienteId && !client)
    return fail(
      req,
      res,
      422,
      "invalid_client",
      "Cliente nao pertence a esta conta.",
    );
  const result = await prisma.$transaction(async (tx) => {
    const base = await tx.ordensServico.create({
      data: {
        contaId: custom.contaId,
        Uid: gerarIdUnicoComMetaFinal("OSO"),
        descricao: parsed.data.descricao,
        garantia: parsed.data.garantia,
        descricaoCliente: parsed.data.observacoes,
        clienteId: client?.id,
        operadorId: custom.userId,
        status: "ABERTA",
      },
    });
    const ourive = await (tx as any).ouriveOrdem.create({
      data: {
        contaId: custom.contaId,
        ordemServicoId: base.id,
        tipo: parsed.data.tipo,
        codigoRastreio: `OUR-${base.id}-${randomBytes(3).toString("hex").toUpperCase()}`,
        observacoes: parsed.data.observacoes,
        prazoPrevisto: parsed.data.prazoPrevisto,
      },
    });
    for (const [index, piece] of parsed.data.pecas.entries()) {
      const saved = await (tx as any).ourivePeca.create({
        data: {
          ordemOuriveId: ourive.id,
          descricao: piece.descricao,
          metal: piece.metal,
          pedras: piece.pedras,
          pesoInformado: piece.pesoInformado,
          estadoConservacao: piece.estadoConservacao,
          checklistRecebimento: piece.checklistRecebimento,
          codigoRastreio: `${ourive.codigoRastreio}-${index + 1}`,
        },
      });
      if (piece.fotos.length)
        await (tx as any).ourivePecaFoto.createMany({
          data: piece.fotos.map((photo) => ({ pecaId: saved.id, ...photo })),
        });
    }
    await event(
      tx,
      ourive.id,
      "RECEBIMENTO",
      parsed.data.tipo === "ENCOMENDA"
        ? "Encomenda registrada."
        : "Peça(s) recebida(s) sob custodia.",
      custom.userId,
      { tipo: parsed.data.tipo },
    );
    return ourive;
  });
  notify(
    custom.contaId,
    "Nova ordem de ourive",
    "Uma peça foi recebida sob custódia.",
  );
  return ok(req, res, await orderDetails(custom.contaId, result.id), 201);
}

export async function listOrders(req: Request, res: Response) {
  const custom = own(req);
  const access = await getOuriveAccess(custom);
  const page = Math.max(1, Number(req.query.page || 1));
  const size = Math.min(100, Math.max(1, Number(req.query.pageSize || req.query.size || 20)));
  const where: any = {
    contaId: custom.contaId,
    ...(req.query.status ? { status: String(req.query.status) } : {}),
  };
  if (
    !access.capabilities.includes("CONFIGURAR") &&
    access.papeis.includes("OURIVE")
  ) {
    const ownStages = await db.ouriveEtapaResponsavel.findMany({
      where: { usuarioId: custom.userId },
      select: { etapaId: true },
    });
    const stages = await db.ouriveEtapa.findMany({
      where: { id: { in: ownStages.map((item: any) => item.etapaId) } },
      select: { ordemOuriveId: true },
    });
    where.id = {
      in: [...new Set(stages.map((item: any) => item.ordemOuriveId))],
    };
  }
  const search = String(req.query.search || "").trim();
  if (search) {
    const baseIds = (
      await prisma.ordensServico.findMany({
        where: {
          contaId: custom.contaId,
          OR: [
            { descricao: { contains: search } },
            { Cliente: { nome: { contains: search } } },
          ],
        },
        select: { id: true },
      })
    ).map((item: any) => item.id);
    where.OR = [
      { codigoRastreio: { contains: search } },
      { ordemServicoId: { in: baseIds } },
    ];
  }
  const [items, total] = await Promise.all([
    db.ouriveOrdem.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * size,
      take: size,
    }),
    db.ouriveOrdem.count({ where }),
  ]);
  const bases = await prisma.ordensServico.findMany({
    where: {
      id: { in: items.map((item: any) => item.ordemServicoId) },
      contaId: custom.contaId,
    },
    include: { Cliente: { select: { nome: true } } },
  });
  const data = items.map((item: any) => ({
      ...item,
      ordemServico: bases.find((base) => base.id === item.ordemServicoId),
    }));
  // Contrato consumido pelo componente DataTable compartilhado. Mantém a resposta
  // legada abaixo para as telas que ainda usam o repositório diretamente.
  if (req.query.pageSize !== undefined)
    return res.json({ data, page, pageSize: size, total, totalPages: Math.max(1, Math.ceil(total / size)) });
  return ok(req, res, {
    items: data,
    page,
    size,
    total,
  });
}
export async function listPurchaseNeeds(req: Request, res: Response) {
  const custom = own(req);
  const status = z
    .enum(["PENDENTE", "ATENDIDA", "CANCELADA"])
    .safeParse(req.query.status);
  const needs = await db.ouriveNecessidadeCompra.findMany({
    where: {
      contaId: custom.contaId,
      ...(status.success ? { status: status.data } : { status: "PENDENTE" }),
    },
    orderBy: { createdAt: "asc" },
  });
  const orders = await db.ouriveOrdem.findMany({
    where: {
      contaId: custom.contaId,
      id: { in: [...new Set(needs.map((need: any) => need.ordemOuriveId))] },
    },
    select: { id: true, codigoRastreio: true, ordemServicoId: true, prazoPrevisto: true },
  });
  const [products, baseOrders] = await Promise.all([
    prisma.produto.findMany({
      where: {
        contaId: custom.contaId,
        id: { in: [...new Set(needs.map((need: any) => need.produtoId))] },
      },
      select: { id: true, nome: true },
    }),
    prisma.ordensServico.findMany({
      where: {
        contaId: custom.contaId,
        id: { in: orders.map((order: any) => order.ordemServicoId) },
      },
      include: { Cliente: { select: { nome: true } } },
    }),
  ]);
  return ok(
    req,
    res,
    needs.map((need: any) => {
      const order = orders.find((item: any) => item.id === need.ordemOuriveId);
      const baseOrder = baseOrders.find((item) => item.id === order?.ordemServicoId);
      return {
        ...need,
        produto: products.find((item) => item.id === need.produtoId),
        ordem: order
          ? {
              id: order.id,
              codigoRastreio: order.codigoRastreio,
              prazoPrevisto: order.prazoPrevisto,
              descricao: baseOrder?.descricao,
              cliente: baseOrder?.Cliente,
            }
          : undefined,
      };
    }),
  );
}
export async function getOrder(req: Request, res: Response) {
  const custom = own(req);
  const id = Number(req.params.id);
  const result = await orderDetails(custom.contaId, id);
  if (!result)
    return fail(req, res, 404, "order_not_found", "Ordem nao encontrada.");
  return (await canAccessOrder(custom, id))
    ? ok(req, res, result)
    : fail(
        req,
        res,
        403,
        "ourive_not_assigned",
        "Esta ordem nao foi atribuida a voce.",
      );
}

const operationalStatusSchema = z.enum([
  "RECEBIDA",
  "ORCAMENTO",
  "AGUARDANDO_MATERIAL",
  "PRONTA_PRODUCAO",
  "PRODUCAO",
  "FINALIZADA",
  "REVISAO",
  "PRONTA_ENTREGA",
  "ENTREGUE",
  "RECUSADA",
  "CANCELADA",
]);

export async function updateOrderStatus(req: Request, res: Response) {
  const custom = own(req);
  const parsed = z
    .object({ status: operationalStatusSchema, observacao: z.string().max(1000).optional() })
    .safeParse(req.body);
  if (!parsed.success)
    return fail(req, res, 422, "validation_error", "Status inválido.");
  const order = await orderForAccount(custom.contaId, Number(req.params.id));
  if (!order) return fail(req, res, 404, "order_not_found", "Ordem não encontrada.");
  if (order.status === parsed.data.status) return ok(req, res, { ...order, idempotente: true });
  const transitions: Record<string, string[]> = {
    RECEBIDA: ["ORCAMENTO", "CANCELADA"],
    ORCAMENTO: ["AGUARDANDO_MATERIAL", "PRONTA_PRODUCAO", "CANCELADA"],
    AGUARDANDO_MATERIAL: ["PRONTA_PRODUCAO", "CANCELADA"],
    PRONTA_PRODUCAO: ["ORCAMENTO", "CANCELADA"],
    PRODUCAO: ["CANCELADA"],
    FINALIZADA: ["REVISAO", "PRONTA_ENTREGA", "PRODUCAO"],
    REVISAO: ["FINALIZADA", "PRONTA_ENTREGA", "PRODUCAO"],
    PRONTA_ENTREGA: ["FINALIZADA"],
  };
  if (!transitions[order.status]?.includes(parsed.data.status))
    return fail(
      req,
      res,
      409,
      "invalid_order_transition",
      "Essa mudança exige a ação operacional correspondente na ordem.",
    );
  await prisma.$transaction(async (tx) => {
    await (tx as any).ouriveOrdem.update({
      where: { id: order.id },
      data: { status: parsed.data.status },
    });
    await event(
      tx,
      order.id,
      "STATUS",
      `Status alterado de ${order.status} para ${parsed.data.status}.`,
      custom.userId,
      { anterior: order.status, novo: parsed.data.status, observacao: parsed.data.observacao },
    );
  });
  return ok(req, res, { ordemId: order.id, status: parsed.data.status });
}

export async function getOrderFinancial(req: Request, res: Response) {
  const custom = own(req);
  const order = await orderForAccount(custom.contaId, Number(req.params.id));
  if (!order) return fail(req, res, 404, "order_not_found", "Ordem não encontrada.");
  try {
    const calculation = await financialCalculationForOrder(custom.contaId, order);
    const repasses = await db.ouriveRepasse.findMany({
      where: { ordemOuriveId: order.id },
      orderBy: { usuarioId: "asc" },
    });
    const users = await prisma.usuarios.findMany({
      where: { contaId: custom.contaId, id: { in: repasses.map((item: any) => item.usuarioId) } },
      select: { id: true, nome: true },
    });
    const repasseResponsavelIds = [
      ...new Set(repasses.map((item: any) => Number(item.usuarioId))),
    ];
    return ok(req, res, {
      status: order.financeiroStatus,
      consolidadoEm: order.financeiroConsolidadoEm,
      reabertoEm: order.financeiroReabertoEm,
      responsavelIds: repasseResponsavelIds.length
        ? repasseResponsavelIds
        : calculation.responsavelIds,
      memoria: order.memoriaCalculoFinanceiro || calculation.memoria,
      detalhamento: calculation.detalhamento,
      repasses: repasses.map((repasse: any) => ({
        ...repasse,
        usuario: users.find((user) => user.id === repasse.usuarioId),
      })),
    });
  } catch (error: any) {
    return fail(
      req,
      res,
      409,
      error.message || "financial_calculation_unavailable",
      "O orçamento precisa estar aprovado para calcular o financeiro.",
    );
  }
}

export async function updateOrderFinancial(req: Request, res: Response) {
  const custom = own(req);
  const parsed = z
    .object({ valorMaoObra: z.coerce.number().nonnegative().max(99_999_999) })
    .safeParse(req.body);
  if (!parsed.success)
    return fail(req, res, 422, "validation_error", "Valor de mão de obra inválido.");
  const order = await orderForAccount(custom.contaId, Number(req.params.id));
  if (!order) return fail(req, res, 404, "order_not_found", "Ordem não encontrada.");
  if (order.financeiroConsolidadoEm)
    return fail(req, res, 409, "financial_locked", "Reabra o financeiro antes de alterar valores.");
  await prisma.$transaction(async (tx) => {
    await (tx as any).ouriveOrdem.update({
      where: { id: order.id },
      data: { valorMaoObra: money(parsed.data.valorMaoObra), financeiroStatus: "CALCULADO" },
    });
    await event(tx, order.id, "FINANCEIRO", "Mão de obra atualizada.", custom.userId, {
      anterior: String(order.valorMaoObra || 0),
      novo: money(parsed.data.valorMaoObra).toFixed(2),
    });
  });
  return ok(req, res, { ordemId: order.id });
}

export async function consolidateOrderFinancial(req: Request, res: Response) {
  const custom = own(req);
  const parsed = z
    .object({
      responsavelIds: z.array(z.coerce.number().int().positive()).min(1).max(100).optional(),
    })
    .safeParse(req.body || {});
  if (!parsed.success)
    return fail(
      req,
      res,
      422,
      "validation_error",
      "Selecione ao menos um ourives responsável.",
      parsed.error.flatten(),
    );
  const order = await orderForAccount(custom.contaId, Number(req.params.id));
  if (!order) return fail(req, res, 404, "order_not_found", "Ordem não encontrada.");
  if (order.financeiroConsolidadoEm)
    return ok(req, res, { ordemId: order.id, consolidadoEm: order.financeiroConsolidadoEm, idempotente: true });
  if (!["FINALIZADA", "REVISAO", "PRONTA_ENTREGA"].includes(order.status))
    return fail(req, res, 409, "production_not_finalized", "Finalize a produção antes do financeiro.");
  const pendingPurchases = await db.ouriveNecessidadeCompra.count({
    where: { ordemOuriveId: order.id, status: "PENDENTE" },
  });
  const pendingMaterials = await db.ouriveMaterial.count({
    where: { ordemOuriveId: order.id, consumidoEm: { not: null }, finalizadoEm: null },
  });
  if (pendingPurchases || pendingMaterials)
    return fail(req, res, 409, "materials_not_reconciled", "Conclua compras e pesos dos materiais.");
  try {
    const calculation = await financialCalculationForOrder(custom.contaId, order);
    const responsavelIds = parsed.data.responsavelIds
      ? [...new Set(parsed.data.responsavelIds.map(Number))]
      : calculation.responsavelIds;
    if (parsed.data.responsavelIds) {
      const validOurives = await db.ouriveUsuarioPapel.findMany({
        where: {
          contaId: custom.contaId,
          papel: "OURIVE",
          usuarioId: { in: responsavelIds },
        },
        select: { usuarioId: true },
      });
      if (validOurives.length !== responsavelIds.length)
        return fail(
          req,
          res,
          422,
          "invalid_ourive_responsible",
          "Um ou mais responsáveis selecionados não são ourives desta conta.",
        );
    }
    const valorOurives = new Decimal(calculation.memoria.valorOurives);
    const splits = valorOurives.gt(0)
      ? dividirRepasseOurives(valorOurives, responsavelIds)
      : [];
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await (tx as any).ouriveOrdem.update({
        where: { id: order.id },
        data: {
          financeiroStatus: "CONSOLIDADO",
          financeiroConsolidadoEm: now,
          financeiroReabertoEm: null,
          percentualLojaAplicado: calculation.memoria.percentualLoja,
          percentualOurivesAplicado: calculation.memoria.percentualOurives,
          memoriaCalculoFinanceiro: calculation.memoria,
        },
      });
      for (const split of splits)
        await (tx as any).ouriveRepasse.upsert({
          where: {
            ordemOuriveId_usuarioId: { ordemOuriveId: order.id, usuarioId: split.usuarioId },
          },
          create: {
            contaId: custom.contaId,
            ordemOuriveId: order.id,
            usuarioId: split.usuarioId,
            valor: split.valor,
          },
          update: { valor: split.valor, status: "PENDENTE", pagoEm: null },
        });
      await event(tx, order.id, "FINANCEIRO", "Financeiro consolidado.", custom.userId, {
        memoria: calculation.memoria,
        repasses: splits,
      });
    });
    return ok(req, res, { ordemId: order.id, consolidadoEm: now, memoria: calculation.memoria });
  } catch (error: any) {
    return fail(
      req,
      res,
      422,
      error.message || "financial_consolidation_failed",
      error.message === "ourive_responsible_required"
        ? "Selecione ao menos um ourives responsável antes de consolidar."
        : "Não foi possível consolidar o financeiro.",
    );
  }
}

export async function reopenOrderFinancial(req: Request, res: Response) {
  const custom = own(req);
  const parsed = z.object({ motivo: z.string().min(3).max(1000) }).safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Informe o motivo.");
  const order = await orderForAccount(custom.contaId, Number(req.params.id));
  if (!order) return fail(req, res, 404, "order_not_found", "Ordem não encontrada.");
  if (!order.financeiroConsolidadoEm) return ok(req, res, { ordemId: order.id, idempotente: true });
  const paid = await db.ouriveRepasse.count({ where: { ordemOuriveId: order.id, status: "PAGO" } });
  if (paid || order.faturadaEm)
    return fail(req, res, 409, "financial_already_posted", "Não é possível reabrir após pagamento ou faturamento.");
  await prisma.$transaction(async (tx) => {
    await (tx as any).ouriveRepasse.deleteMany({
      where: { ordemOuriveId: order.id, status: "PENDENTE" },
    });
    await (tx as any).ouriveOrdem.update({
      where: { id: order.id },
      data: {
        financeiroStatus: "ABERTO",
        financeiroConsolidadoEm: null,
        financeiroReabertoEm: new Date(),
        percentualLojaAplicado: null,
        percentualOurivesAplicado: null,
        memoriaCalculoFinanceiro: null,
      },
    });
    await event(tx, order.id, "FINANCEIRO", "Financeiro reaberto.", custom.userId, {
      motivo: parsed.data.motivo,
    });
  });
  return ok(req, res, { ordemId: order.id });
}

export async function finalizeProduction(req: Request, res: Response) {
  const custom = own(req);
  const parsed = z.object({ pesoFinal: z.coerce.number().positive().max(999_999) }).safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Peso final inválido.");
  const order = await orderForAccount(custom.contaId, Number(req.params.id));
  if (!order) return fail(req, res, 404, "order_not_found", "Ordem não encontrada.");
  if (order.status !== "PRODUCAO")
    return fail(req, res, 409, "invalid_order_transition", "A ordem não está em produção.");
  const [materials, stages, approvedStages] = await Promise.all([
    db.ouriveMaterial.count({
      where: { ordemOuriveId: order.id, consumidoEm: { not: null }, finalizadoEm: null },
    }),
    db.ouriveEtapa.count({ where: { ordemOuriveId: order.id } }),
    db.ouriveEtapa.count({ where: { ordemOuriveId: order.id, status: "APROVADA" } }),
  ]);
  if (materials) return fail(req, res, 409, "materials_not_reconciled", "Finalize todos os materiais.");
  if (stages && stages !== approvedStages)
    return fail(req, res, 409, "stages_not_approved", "Todas as etapas precisam estar aprovadas.");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await (tx as any).ouriveOrdem.update({
      where: { id: order.id },
      data: { status: "FINALIZADA", pesoFinal: parsed.data.pesoFinal, producaoFinalizadaEm: now },
    });
    await event(tx, order.id, "PRODUCAO", "Produção finalizada com peso final registrado.", custom.userId, {
      pesoFinal: String(parsed.data.pesoFinal),
      statusAnterior: order.status,
      statusNovo: "FINALIZADA",
    });
  });
  return ok(req, res, { ordemId: order.id, status: "FINALIZADA", pesoFinal: parsed.data.pesoFinal });
}

export async function saveBudget(req: Request, res: Response) {
  const parsed = budgetSchema.safeParse(req.body);
  if (!parsed.success)
    return fail(
      req,
      res,
      422,
      "validation_error",
      "Orcamento invalido.",
      parsed.error.flatten(),
    );
  const custom = own(req);
  const order = await orderForAccount(custom.contaId, Number(req.params.id));
  if (!order)
    return fail(req, res, 404, "order_not_found", "Ordem nao encontrada.");
  if (
    ["PRODUCAO", "REVISAO", "ENTREGUE", "RECUSADA", "CANCELADA"].includes(
      order.status,
    )
  )
    return fail(
      req,
      res,
      409,
      "budget_locked",
      "O orcamento nao pode ser alterado neste status.",
    );
  const config = await db.ouriveConfiguracao.findUnique({
    where: { contaId: custom.contaId },
  });
  const percentualPerdaPadrao = new Decimal(
    String(config?.percentualPerdaPadrao ?? 10),
  ).div(100);
  if (
    parsed.data.materiais.some(
      (material) =>
        material.unidade === "QUANTIDADE" && !Number.isInteger(material.quantidade),
    )
  )
    return fail(
      req,
      res,
      422,
      "invalid_material_measurement",
      "Materiais por quantidade devem usar números inteiros.",
    );
  if (
    parsed.data.materiais.some(
      (material) =>
        !material.fornecidoPeloCliente &&
        material.unidade === "PESO" &&
        !Number.isInteger(material.quantidade),
    )
  )
    return fail(
      req,
      res,
      422,
      "invalid_store_weight",
      "O estoque atual trabalha em gramas inteiras; informe o peso da loja em gramas inteiras.",
    );
  const products = await prisma.produto.findMany({
    where: {
      contaId: custom.contaId,
      id: { in: parsed.data.materiais.map((item) => item.produtoId) },
    },
    select: {
      id: true,
      nome: true,
      estoque: true,
      preco: true,
      precoCompra: true,
      custoMedioProducao: true,
    },
  });
  if (
    products.length !==
    new Set(parsed.data.materiais.map((item) => item.produtoId)).size
  )
    return fail(
      req,
      res,
      422,
      "invalid_material",
      "Um material nao pertence a esta conta.",
    );
  const productById = new Map(products.map((product) => [product.id, product]));
  // A falta precisa considerar linhas repetidas do mesmo produto na mesma OS.
  const stockRemainingByProduct = new Map(
    products.map((product) => [product.id, Number(product.estoque || 0)]),
  );
  // Mesmo quando a tela ainda enviar o valor zerado (OS antigas ou cache do navegador),
  // o material da empresa deve compor a proposta com o preço cadastrado da variante.
  const materials = parsed.data.materiais.map((material) => {
    const product = productById.get(material.produtoId)!;
    const medida = new Decimal(material.quantidade).toDecimalPlaces(3);
    const quantidadeEstoque = stockUnitsForMaterial(material.unidade, medida);
    const saldoDisponivel = stockRemainingByProduct.get(material.produtoId) || 0;
    const faltaEstoque = material.fornecidoPeloCliente
      ? 0
      : Math.max(0, quantidadeEstoque - saldoDisponivel);
    if (!material.fornecidoPeloCliente)
      stockRemainingByProduct.set(
        material.produtoId,
        Math.max(0, saldoDisponivel - quantidadeEstoque),
      );
    const internalCost =
      material.custoUnitario > 0
        ? material.custoUnitario
        : Number(product.custoMedioProducao ?? product.precoCompra ?? 0);
    const customerValue = material.fornecidoPeloCliente
      ? 0
      : material.valorUnitario > 0
        ? material.valorUnitario
        : Number(product.preco ?? internalCost);
    return {
      ...material,
      medida,
      quantidadeEstoque,
      faltaEstoque,
      medidaNecessariaCompra: measureFromStockUnits(
        material.unidade,
        faltaEstoque,
      ),
      custoUnitario: internalCost,
      valorUnitario: customerValue,
    };
  });
  const gross = parsed.data.servicos.reduce(
    (total, service) =>
      total.plus(money(service.valor).mul(service.quantidade)),
    new Decimal(0),
  );
  const materialValue = materials.reduce(
    (total, material) =>
      material.fornecidoPeloCliente
        ? total
        : total.plus(money(material.valorUnitario).mul(material.medida)),
    new Decimal(0),
  );
  const materialCost = materials.reduce(
    (total, material) =>
      material.fornecidoPeloCliente
        ? total
        : total.plus(money(material.custoUnitario).mul(material.medida)),
    new Decimal(0),
  );
  const finalValue = Decimal.max(
    0,
    gross.plus(materialValue).minus(money(parsed.data.desconto)),
  );
  const budget = await prisma.$transaction(async (tx) => {
    const current = await (tx as any).ouriveOrcamento.findFirst({
      where: { ordemOuriveId: order.id },
      orderBy: { versao: "desc" },
    });
    if (current?.enviadoEm)
      await (tx as any).ouriveOrcamento.update({
        where: { id: current.id },
        data: { invalidoEm: new Date() },
      });
    const created = await (tx as any).ouriveOrcamento.create({
      data: {
        ordemOuriveId: order.id,
        versao: (current?.versao || 0) + 1,
        servicos: parsed.data.servicos,
        desconto: money(parsed.data.desconto),
        prazoPrevisto: parsed.data.prazoPrevisto,
        custoEstimado: materialCost,
        valorFinal: finalValue,
      },
    });
    await tx.itensOrdensServico.deleteMany({
      where: { ordemId: order.ordemServicoId },
    });
    await tx.itensOrdensServico.createMany({
      data: parsed.data.servicos.map((service) => ({
        ordemId: order.ordemServicoId,
        itemName: service.descricao,
        tipo: "SERVICO",
        quantidade: service.quantidade,
        valor: money(service.valor),
      })),
    });
    await (tx as any).ouriveNecessidadeCompra.deleteMany({
      where: { ordemOuriveId: order.id, status: "PENDENTE" },
    });
    await (tx as any).ouriveMaterial.deleteMany({
      where: { ordemOuriveId: order.id, quantidadeConsumida: 0 },
    });
    for (const material of materials) {
      const savedMaterial = await (tx as any).ouriveMaterial.create({
        data: {
          ordemOuriveId: order.id,
          produtoId: material.produtoId,
          pecaId: material.pecaId,
          fornecidoPeloCliente: material.fornecidoPeloCliente,
          unidade: material.unidade,
          quantidadePlanejada: material.quantidadeEstoque,
          medidaPlanejada: material.medida,
          perdaEstimada:
            material.unidade === "PESO"
              ? material.medida.mul(percentualPerdaPadrao)
              : new Decimal(0),
          necessitaCompra: material.faltaEstoque > 0,
          medidaNecessariaCompra: material.medidaNecessariaCompra,
          observacao: material.observacao,
          custoSnapshot: money(material.custoUnitario),
          valorUnitario: money(material.valorUnitario),
        },
      });
      if (material.faltaEstoque > 0)
        await (tx as any).ouriveNecessidadeCompra.create({
          data: {
            contaId: custom.contaId,
            ordemOuriveId: order.id,
            materialId: savedMaterial.id,
            produtoId: material.produtoId,
            unidade: material.unidade,
            quantidadeNecessaria: material.medidaNecessariaCompra,
          },
        });
    }
    await (tx as any).ouriveOrdem.update({
      where: { id: order.id },
      data: { status: "ORCAMENTO" },
    });
    await tx.ordensServico.update({
      where: { id: order.ordemServicoId },
      data: { status: "ORCAMENTO", desconto: money(parsed.data.desconto) },
    });
    await event(
      tx,
      order.id,
      "ORCAMENTO",
      `Orcamento versao ${(current?.versao || 0) + 1} criado.`,
      custom.userId,
      {
        valorFinal: finalValue.toString(),
        materiaisEmpresa: materialValue.toString(),
        necessidadesCompra: materials.filter((material) => material.faltaEstoque > 0).map(
          (material) => ({
            produtoId: material.produtoId,
            quantidade: material.medidaNecessariaCompra.toString(),
            unidade: material.unidade,
          }),
        ),
      },
    );
    return created;
  });
  return ok(req, res, budget, 201);
}

export async function sendBudget(req: Request, res: Response) {
  const custom = own(req);
  const order = await orderForAccount(custom.contaId, Number(req.params.id));
  if (!order)
    return fail(req, res, 404, "order_not_found", "Ordem nao encontrada.");
  const budget = await db.ouriveOrcamento.findFirst({
    where: { ordemOuriveId: order.id, invalidoEm: null },
    orderBy: { versao: "desc" },
  });
  if (!budget)
    return fail(
      req,
      res,
      409,
      "budget_missing",
      "Crie o orcamento antes de envia-lo.",
    );
  if (budget.aprovadoEm || budget.recusadoEm)
    return fail(
      req,
      res,
      409,
      "budget_closed",
      "Este orcamento ja possui uma decisao.",
    );
  const config = await db.ouriveConfiguracao.upsert({
    where: { contaId: custom.contaId },
    create: { contaId: custom.contaId },
    update: {},
  });
  const rawToken = token();
  const expires = new Date(Date.now() + config.prazoAprovacaoDias * 86_400_000);
  await db.ouriveOrcamento.update({
    where: { id: budget.id },
    data: {
      tokenHash: hash(rawToken),
      tokenExpiraEm: expires,
      enviadoEm: new Date(),
    },
  });
  await db.ouriveEvento.create({
    data: {
      ordemOuriveId: order.id,
      tipo: "ORCAMENTO",
      descricao: `Orcamento versao ${budget.versao} enviado para aprovacao.`,
      autorId: custom.userId,
    },
  });
  notify(
    custom.contaId,
    "Orçamento Ourive enviado",
    `Orçamento ${order.codigoRastreio} aguarda aprovação.`,
  );
  return ok(req, res, {
    versao: budget.versao,
    expiraEm: expires,
    token: rawToken,
    url: `/ourive/orcamento/${rawToken}`,
  });
}

async function decideBudget(
  budget: any,
  accepted: boolean,
  observation: string | undefined,
  origin: string,
) {
  const order = await db.ouriveOrdem.findFirst({
    where: { id: budget.ordemOuriveId },
  });
  if (!order) throw new Error("ourive_order_missing");
  if (
    budget.invalidoEm ||
    budget.aprovadoEm ||
    budget.recusadoEm ||
    (origin === "LINK_PUBLICO" &&
      (!budget.enviadoEm ||
        !budget.tokenExpiraEm ||
        budget.tokenExpiraEm < new Date()))
  )
    return { error: "budget_unavailable" };
  const applied = await prisma.$transaction(async (tx) => {
    const changed = await (tx as any).ouriveOrcamento.updateMany({
      where: {
        id: budget.id,
        aprovadoEm: null,
        recusadoEm: null,
        invalidoEm: null,
      },
      data: accepted
        ? {
            aprovadoEm: new Date(),
            aprovacaoOrigem: origin,
            aprovacaoObservacao: observation,
          }
        : {
            recusadoEm: new Date(),
            aprovacaoOrigem: origin,
            aprovacaoObservacao: observation,
          },
    });
    if (!changed.count) return false;
    const pendingPurchases = accepted
      ? await (tx as any).ouriveNecessidadeCompra.count({
          where: { ordemOuriveId: order.id, status: "PENDENTE" },
        })
      : 0;
    const nextStatus = accepted
      ? pendingPurchases
        ? "AGUARDANDO_MATERIAL"
        : "PRONTA_PRODUCAO"
      : "RECUSADA";
    await (tx as any).ouriveOrdem.update({
      where: { id: order.id },
      data: { status: nextStatus },
    });
    await tx.ordensServico.update({
      where: { id: order.ordemServicoId },
      data: { status: accepted ? "APROVADA" : "CANCELADA" },
    });
    await event(
      tx,
      order.id,
      accepted ? "APROVACAO" : "RECUSA",
      accepted ? "Orcamento aprovado." : "Orcamento recusado.",
      undefined,
      { origem: origin, versao: budget.versao, observacao: observation, novoStatus: nextStatus },
    );
    return true;
  });
  if (!applied) return { error: "budget_unavailable" };
  sendOuriveOrderUpdated(order.contaId, {
    ordemId: order.id,
    status: accepted ? "APROVADO" : "RECUSADO",
    versao: budget.versao,
    origem: origin,
  });
  return { orderId: order.id, accepted };
}
export async function decideBudgetPublic(req: Request, res: Response) {
  const rawToken = String(req.params.token);
  const parsed = z
    .object({
      decisao: z.enum(["APROVAR", "RECUSAR"]),
      observacao: z.string().max(2000).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return fail(req, res, 422, "validation_error", "Decisao invalida.");
  const budget = await db.ouriveOrcamento.findFirst({
    where: { tokenHash: hash(rawToken) },
  });
  if (!budget)
    return fail(
      req,
      res,
      404,
      "budget_not_found",
      "Link de orcamento invalido.",
    );
  const result = await decideBudget(
    budget,
    parsed.data.decisao === "APROVAR",
    parsed.data.observacao,
    "LINK_PUBLICO",
  );
  if ("error" in result)
    return fail(
      req,
      res,
      409,
      String(result.error || "budget_unavailable"),
      "Este orcamento nao esta mais disponivel.",
    );
  const order = await db.ouriveOrdem.findFirst({
    where: { id: result.orderId },
  });
  if (order)
    notify(
      order.contaId,
      result.accepted ? "Orçamento de OS aprovado" : "Orçamento de OS recusado",
      result.accepted
        ? `O cliente aprovou o orçamento da OS ${order.codigoRastreio}.`
        : `O cliente recusou o orçamento da OS ${order.codigoRastreio}.`,
    );
  return ok(req, res, result);
}
export async function decideBudgetInternal(req: Request, res: Response) {
  const custom = own(req);
  const parsed = z
    .object({
      aprovar: z.boolean(),
      observacao: z.string().max(2000).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return fail(req, res, 422, "validation_error", "Decisao invalida.");
  const order = await orderForAccount(custom.contaId, Number(req.params.id));
  if (!order)
    return fail(req, res, 404, "order_not_found", "Ordem nao encontrada.");
  const budget = await db.ouriveOrcamento.findFirst({
    where: { ordemOuriveId: order.id, invalidoEm: null },
    orderBy: { versao: "desc" },
  });
  if (!budget)
    return fail(req, res, 409, "budget_missing", "Nao ha orcamento ativo.");
  const result = await decideBudget(
    budget,
    parsed.data.aprovar,
    parsed.data.observacao,
    "INTERNO",
  );
  if ("error" in result)
    return fail(
        req,
        res,
        409,
        String(result.error || "budget_unavailable"),
        "Este orcamento nao esta mais disponivel.",
      );
  notify(
    custom.contaId,
    result.accepted ? "Orçamento de OS aprovado" : "Orçamento de OS recusado",
    result.accepted
      ? `O orçamento da OS ${order.codigoRastreio} foi aprovado internamente.`
      : `O orçamento da OS ${order.codigoRastreio} foi recusado internamente.`,
  );
  return ok(req, res, result);
}
export async function publicBudget(req: Request, res: Response) {
  const budget = await db.ouriveOrcamento.findFirst({
    where: { tokenHash: hash(String(req.params.token)) },
  });
  if (
    !budget ||
    budget.invalidoEm ||
    !budget.enviadoEm ||
    !budget.tokenExpiraEm ||
    budget.tokenExpiraEm < new Date()
  )
    return fail(
      req,
      res,
      404,
      "budget_not_found",
      "Link de orcamento invalido ou expirado.",
    );
  const order = await db.ouriveOrdem.findFirst({
    where: { id: budget.ordemOuriveId },
  });
  if (!order)
    return fail(
      req,
      res,
      404,
      "budget_not_found",
      "Link de orcamento invalido ou expirado.",
    );
  const base =
    order &&
    (await prisma.ordensServico.findFirst({
      where: { id: order.ordemServicoId },
      include: { Cliente: { select: { nome: true } } },
    }));
  const pieces =
    order &&
    (await db.ourivePeca.findMany({
      where: { ordemOuriveId: order.id },
      select: {
        descricao: true,
        metal: true,
        pedras: true,
        codigoRastreio: true,
      },
    }));
  const materials =
    order &&
    (await db.ouriveMaterial.findMany({
      where: { ordemOuriveId: order.id },
      orderBy: { id: "asc" },
    }));
  const products = await prisma.produto.findMany({
    where: {
      contaId: order.contaId,
      id: { in: (materials || []).map((material: any) => material.produtoId) },
    },
    select: { id: true, nome: true, nomeVariante: true },
  });
  const materialLines: Array<{
    quantidade: Decimal.Value;
    unidade: string;
    fornecidoPeloCliente: boolean;
    valorUnitario: Decimal.Value;
    descricao: string;
  }> = (materials || []).map((material: any) => ({
    quantidade: material.medidaPlanejada || material.quantidadePlanejada,
    unidade: material.unidade,
    fornecidoPeloCliente: material.fornecidoPeloCliente,
    valorUnitario: material.valorUnitario,
    descricao:
      products.find((product) => product.id === material.produtoId)?.nome ||
      "Material",
  }));
  const materiaisEmpresa = materialLines.filter(
    (material: (typeof materialLines)[number]) => !material.fornecidoPeloCliente,
  );
  const materiaisCliente = materialLines.filter(
    (material: (typeof materialLines)[number]) => material.fornecidoPeloCliente,
  );
  const totalMateriaisEmpresa = materiaisEmpresa.reduce(
    (total: Decimal, material: (typeof materialLines)[number]) =>
      total.plus(money(material.valorUnitario).mul(material.quantidade)),
    new Decimal(0),
  );
  return ok(req, res, {
    ordem: {
      codigoRastreio: order?.codigoRastreio,
      cliente: base?.Cliente?.nome,
      descricao: base?.descricao,
      pecas: pieces,
    },
    orcamento: {
      versao: budget.versao,
      servicos: budget.servicos,
      desconto: budget.desconto,
      prazoPrevisto: budget.prazoPrevisto,
      valorFinal: budget.valorFinal,
      expiraEm: budget.tokenExpiraEm,
      materiais: materialLines,
      materiaisEmpresa,
      materiaisCliente,
      totalMateriaisEmpresa,
    },
  });
}

export async function createStage(req: Request, res: Response) {
  const parsed = stageSchema.safeParse(req.body);
  if (!parsed.success)
    return fail(
      req,
      res,
      422,
      "validation_error",
      "Etapa invalida.",
      parsed.error.flatten(),
    );
  const custom = own(req);
  const order = await orderForAccount(custom.contaId, Number(req.params.id));
  if (!order)
    return fail(req, res, 404, "order_not_found", "Ordem nao encontrada.");
  if (["ENTREGUE", "RECUSADA", "CANCELADA"].includes(order.status))
    return fail(req, res, 409, "order_closed", "A ordem esta encerrada.");
  if (order.status !== "PRODUCAO")
    return fail(
      req,
      res,
      409,
      "budget_approval_required",
      "A produção e suas etapas só podem iniciar após a aprovação do orçamento.",
    );
  const responsibleIds = [...new Set(parsed.data.responsavelIds)];
  const ourives = await db.ouriveUsuarioPapel.findMany({
    where: {
      contaId: custom.contaId,
      usuarioId: { in: responsibleIds },
      papel: "OURIVE",
    },
    select: { usuarioId: true },
  });
  if (ourives.length !== responsibleIds.length)
    return fail(
      req,
      res,
      422,
      "invalid_assignee_role",
      "Cada responsavel deve possuir o papel Ourive.",
    );
  if (parsed.data.especialidadeId) {
    const specialty = await db.ouriveEspecialidade.findFirst({
      where: {
        id: parsed.data.especialidadeId,
        contaId: custom.contaId,
        ativo: true,
      },
    });
    if (!specialty)
      return fail(
        req,
        res,
        422,
        "invalid_specialty",
        "Especialidade invalida para esta conta.",
      );
    const links = await db.ouriveUsuarioEspecialidade.findMany({
      where: {
        contaId: custom.contaId,
        especialidadeId: specialty.id,
        usuarioId: { in: responsibleIds },
      },
      select: { usuarioId: true },
    });
    if (links.length !== responsibleIds.length)
      return fail(
        req,
        res,
        422,
        "assignee_specialty_mismatch",
        "Todos os responsaveis devem possuir a especialidade da etapa.",
      );
  }
  const commissionUsers = [
    ...new Set(parsed.data.comissoes.map((item) => item.usuarioId)),
  ];
  if (commissionUsers.some((usuarioId) => !responsibleIds.includes(usuarioId)))
    return fail(
      req,
      res,
      422,
      "commission_assignee_mismatch",
      "A comissao deve pertencer a um responsavel da etapa.",
    );
  const stage = await prisma.$transaction(async (tx) => {
    const created = await (tx as any).ouriveEtapa.create({
      data: {
        ordemOuriveId: order.id,
        nome: parsed.data.nome,
        especialidadeId: parsed.data.especialidadeId,
        prazoPrevisto: parsed.data.prazoPrevisto,
        observacao: parsed.data.observacao,
      },
    });
    await (tx as any).ouriveEtapaResponsavel.createMany({
      data: responsibleIds.map((usuarioId) => ({
        etapaId: created.id,
        usuarioId,
      })),
    });
    if (parsed.data.comissoes.length)
      await (tx as any).ouriveComissao.createMany({
        data: parsed.data.comissoes.map((commission) => ({
          ordemOuriveId: order.id,
          etapaId: created.id,
          ...commission,
        })),
      });
    await event(
      tx,
      order.id,
      "ETAPA",
      `Etapa ${created.nome} criada.`,
      custom.userId,
      { responsavelIds: responsibleIds },
    );
    return created;
  });
  return ok(req, res, stage, 201);
}

export async function updateStage(req: Request, res: Response) {
  const custom = own(req);
  const parsed = z
    .object({
      acao: z.enum(["INICIAR", "ENVIAR_REVISAO", "APROVAR", "REPROVAR"]),
      motivoReprovacao: z.string().min(3).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return fail(
      req,
      res,
      422,
      "validation_error",
      "Atualizacao de etapa invalida.",
      parsed.error.flatten(),
    );
  const stage = await db.ouriveEtapa.findFirst({
    where: { id: Number(req.params.etapaId) },
  });
  if (!stage)
    return fail(req, res, 404, "stage_not_found", "Etapa nao encontrada.");
  const order = await orderForAccount(custom.contaId, stage.ordemOuriveId);
  if (!order)
    return fail(req, res, 404, "stage_not_found", "Etapa nao encontrada.");
  if (order.status !== "PRODUCAO")
    return fail(
      req,
      res,
      409,
      "budget_approval_required",
      "As etapas só podem avançar durante uma produção iniciada com orçamento aprovado.",
    );
  const access = await getOuriveAccess(custom);
  const assignee = await db.ouriveEtapaResponsavel.findFirst({
    where: { etapaId: stage.id, usuarioId: custom.userId },
  });
  if (
    access.papeis.includes("OURIVE") &&
    !access.capabilities.includes("CONFIGURAR") &&
    !assignee
  )
    return fail(
      req,
      res,
      403,
      "ourive_not_assigned",
      "Esta etapa nao foi atribuida a voce.",
    );
  if (
    ["APROVAR", "REPROVAR"].includes(parsed.data.acao) &&
    !access.capabilities.includes("REVISAO")
  )
    return fail(
      req,
      res,
      403,
      "review_forbidden",
      "Apenas revisao pode concluir esta etapa.",
    );
  if (
    !["APROVAR", "REPROVAR"].includes(parsed.data.acao) &&
    !access.capabilities.includes("PRODUCAO")
  )
    return fail(
      req,
      res,
      403,
      "production_forbidden",
      "Voce nao possui permissao para executar esta etapa.",
    );
  if (parsed.data.acao === "REPROVAR" && !parsed.data.motivoReprovacao)
    return fail(
      req,
      res,
      422,
      "review_reason_required",
      "Informe o motivo da reprovacao.",
    );
  const changes: any =
    parsed.data.acao === "INICIAR"
      ? { status: "EM_EXECUCAO", iniciadaEm: new Date() }
      : parsed.data.acao === "ENVIAR_REVISAO"
        ? { status: "AGUARDANDO_REVISAO", finalizadaEm: new Date() }
        : parsed.data.acao === "APROVAR"
          ? {
              status: "APROVADA",
              revisadaEm: new Date(),
              revisadaPorId: custom.userId,
              motivoReprovacao: null,
            }
          : {
              status: "REPROVADA",
              revisadaEm: new Date(),
              revisadaPorId: custom.userId,
              motivoReprovacao: parsed.data.motivoReprovacao,
            };
  if (
    (parsed.data.acao === "INICIAR" &&
      stage.status !== "PENDENTE" &&
      stage.status !== "REPROVADA") ||
    (parsed.data.acao === "ENVIAR_REVISAO" && stage.status !== "EM_EXECUCAO") ||
    (["APROVAR", "REPROVAR"].includes(parsed.data.acao) &&
      stage.status !== "AGUARDANDO_REVISAO")
  )
    return fail(
      req,
      res,
      409,
      "invalid_stage_transition",
      "Transicao de etapa invalida.",
    );
  await prisma.$transaction(async (tx) => {
    await (tx as any).ouriveEtapa.update({
      where: { id: stage.id },
      data: changes,
    });
    if (parsed.data.acao === "APROVAR") {
      const budget = await (tx as any).ouriveOrcamento.findFirst({
        where: { ordemOuriveId: order.id, aprovadoEm: { not: null } },
        orderBy: { versao: "desc" },
      });
      const commissions = await (tx as any).ouriveComissao.findMany({
        where: { etapaId: stage.id, consolidadaEm: null },
      });
      for (const commission of commissions) {
        const amount =
          commission.tipo === "PERCENTUAL"
            ? money(budget?.valorFinal).mul(commission.referencia).div(100)
            : money(commission.referencia);
        await (tx as any).ouriveComissao.update({
          where: { id: commission.id },
          data: { valorConsolidado: amount, consolidadaEm: new Date() },
        });
      }
    }
    await event(
      tx,
      order.id,
      parsed.data.acao === "APROVAR" || parsed.data.acao === "REPROVAR"
        ? "REVISAO"
        : "ETAPA",
      `Etapa ${stage.nome}: ${parsed.data.acao}.`,
      custom.userId,
      parsed.data,
    );
  });
  const allStages = await db.ouriveEtapa.count({
    where: { ordemOuriveId: order.id },
  });
  const approvedStages = await db.ouriveEtapa.count({
    where: { ordemOuriveId: order.id, status: "APROVADA" },
  });
  if (allStages > 0 && allStages === approvedStages)
    await db.ouriveEvento.create({
      data: {
        ordemOuriveId: order.id,
        tipo: "PRODUCAO",
        descricao: "Todas as etapas foram aprovadas; a produção pode ser finalizada.",
        autorId: custom.userId,
      },
    });
  return ok(req, res, { etapaId: stage.id, ...changes });
}

export async function startProduction(req: Request, res: Response) {
  const custom = own(req);
  const order = await orderForAccount(custom.contaId, Number(req.params.id));
  if (!order)
    return fail(req, res, 404, "order_not_found", "Ordem nao encontrada.");
  if (!(await canAccessOrder(custom, order.id)))
    return fail(
      req,
      res,
      403,
      "ourive_not_assigned",
      "Esta ordem nao foi atribuida a voce.",
    );
  if (!["ORCAMENTO", "PRONTA_PRODUCAO"].includes(order.status))
    return fail(
      req,
      res,
      409,
      "invalid_order_transition",
      "A producao exige orcamento aprovado.",
    );
  const budget = await db.ouriveOrcamento.findFirst({
    where: { ordemOuriveId: order.id, invalidoEm: null },
    orderBy: { versao: "desc" },
  });
  if (!budget?.aprovadoEm)
    return fail(
      req,
      res,
      409,
      "budget_not_approved",
      "O orcamento precisa estar aprovado antes da producao.",
    );
  let pendingPurchases = await db.ouriveNecessidadeCompra.findMany({
    where: { ordemOuriveId: order.id, status: "PENDENTE" },
    select: { produtoId: true, quantidadeNecessaria: true, unidade: true },
  });
  // Compatibilidade para necessidades criadas antes da correção de peso: se o
  // produto já cobre o peso real em gramas, a necessidade deixa de bloquear a OS.
  if (pendingPurchases.length) {
    const pendingMaterials = await db.ouriveMaterial.findMany({
      where: { ordemOuriveId: order.id, necessitaCompra: true },
      select: { id: true, produtoId: true, medidaPlanejada: true, unidade: true },
    });
    const productIds = Array.from(
      new Set<number>(pendingMaterials.map((item: any) => Number(item.produtoId))),
    );
    const stockRows = await prisma.produto.findMany({
      where: { contaId: custom.contaId, id: { in: productIds } },
      select: { id: true, estoque: true },
    });
    const plannedByProduct = new Map<number, Decimal>();
    for (const material of pendingMaterials)
      plannedByProduct.set(
        material.produtoId,
        (plannedByProduct.get(material.produtoId) || new Decimal(0)).plus(
          material.medidaPlanejada,
        ),
      );
    const coveredProductIds = stockRows
      .filter(
        (product) =>
          new Decimal(product.estoque).gte(plannedByProduct.get(product.id) || 0),
      )
      .map((product) => product.id);
    if (coveredProductIds.length) {
      await prisma.$transaction(async (tx) => {
        await (tx as any).ouriveNecessidadeCompra.updateMany({
          where: {
            ordemOuriveId: order.id,
            status: "PENDENTE",
            produtoId: { in: coveredProductIds },
          },
          data: { status: "CANCELADA" },
        });
        await (tx as any).ouriveMaterial.updateMany({
          where: { ordemOuriveId: order.id, produtoId: { in: coveredProductIds } },
          data: { necessitaCompra: false, medidaNecessariaCompra: 0 },
        });
      });
      pendingPurchases = await db.ouriveNecessidadeCompra.findMany({
        where: { ordemOuriveId: order.id, status: "PENDENTE" },
        select: { produtoId: true, quantidadeNecessaria: true, unidade: true },
      });
    }
  }
  if (pendingPurchases.length)
    return fail(
      req,
      res,
      409,
      "purchase_required",
      "Há materiais da loja aguardando compra antes de iniciar a produção.",
      pendingPurchases,
    );
  try {
    await prisma.$transaction(async (tx) => {
      const materials = await (tx as any).ouriveMaterial.findMany({
        where: { ordemOuriveId: order.id, quantidadeConsumida: 0 },
      });
      for (const material of materials) {
        if (material.fornecidoPeloCliente) {
          await (tx as any).ouriveMaterial.update({
            where: { id: material.id },
            data: {
              quantidadeConsumida: material.quantidadePlanejada,
              medidaConsumida: material.medidaPlanejada,
              medidaUtilizada: material.medidaPlanejada,
              consumidoEm: new Date(),
              custoSnapshot: 0,
            },
          });
          await event(
            tx,
            order.id,
            "MATERIAL",
            "Material fornecido pelo cliente registrado na produção.",
            custom.userId,
            { materialId: material.id, quantidade: material.quantidadePlanejada },
          );
          continue;
        }
        const product = await tx.produto.findFirstOrThrow({
          where: { id: material.produtoId, contaId: custom.contaId },
          select: { id: true, custoMedioProducao: true, precoCompra: true },
        });
        await assertAvailableAndDecrement(
          tx,
          custom.contaId,
          material.produtoId,
          material.quantidadePlanejada,
        );
        // O custo pode ter sido ajustado no orçamento. Preservamos esse snapshot para que
        // alterações posteriores no cadastro do produto não mudem o custo histórico da OS.
        const snapshot = material.custoSnapshot ?? product.custoMedioProducao ?? product.precoCompra ?? 0;
        await (tx as any).ouriveMaterial.update({
          where: { id: material.id },
          data: {
            quantidadeConsumida: material.quantidadePlanejada,
            medidaConsumida: material.medidaPlanejada,
            medidaUtilizada: material.medidaPlanejada,
            consumidoEm: new Date(),
            custoSnapshot: snapshot,
          },
        });
        await tx.movimentacoesEstoque.create({
          data: {
            contaId: custom.contaId,
            Uid: gerarIdUnicoComMetaFinal("MOV"),
            tipo: "SAIDA",
            ordemId: order.ordemServicoId,
            produtoId: material.produtoId,
            quantidade: material.quantidadePlanejada,
            custo: snapshot,
            status: "CONCLUIDO",
          },
        });
      }
      await (tx as any).ouriveOrdem.update({
        where: { id: order.id },
        data: { status: "PRODUCAO", producaoIniciadaEm: new Date() },
      });
      await tx.ordensServico.update({
        where: { id: order.ordemServicoId },
        data: { status: "ANDAMENTO" },
      });
      await event(
        tx,
        order.id,
        "PRODUCAO",
        "Producao iniciada e materiais consumidos.",
        custom.userId,
        { statusAnterior: order.status, statusNovo: "PRODUCAO" },
      );
    });
  } catch (error: any) {
    return fail(
      req,
      res,
      422,
      error.code || "stock_unavailable",
      error.message || "Nao foi possivel baixar o estoque.",
    );
  }
  notify(
    custom.contaId,
    "Produção iniciada",
    `A ordem ${order.codigoRastreio} entrou em produção.`,
  );
  return ok(req, res, { ordemId: order.id, status: "PRODUCAO" });
}

export async function returnMaterial(req: Request, res: Response) {
  const custom = own(req);
  const parsed = z
    .object({ quantidade: z.number().int().positive() })
    .safeParse(req.body);
  if (!parsed.success)
    return fail(req, res, 422, "validation_error", "Quantidade invalida.");
  const material = await db.ouriveMaterial.findFirst({
    where: { id: Number(req.params.materialId) },
  });
  if (!material)
    return fail(
      req,
      res,
      404,
      "material_not_found",
      "Material nao encontrado.",
    );
  const order = await orderForAccount(custom.contaId, material.ordemOuriveId);
  if (!order)
    return fail(
      req,
      res,
      404,
      "material_not_found",
      "Material nao encontrado.",
    );
  if (material.fornecidoPeloCliente)
    return fail(
      req,
      res,
      409,
      "customer_material_not_returnable",
      "Material fornecido pelo cliente nao pode ser devolvido ao estoque da empresa.",
    );
  if (
    parsed.data.quantidade >
    material.quantidadeConsumida - material.quantidadeDevolvida
  )
    return fail(
      req,
      res,
      422,
      "invalid_return",
      "Quantidade devolvida excede o consumo.",
    );
  await prisma.$transaction(async (tx) => {
    await tx.produto.update({
      where: { id: material.produtoId },
      data: { estoque: { increment: parsed.data.quantidade } },
    });
    await (tx as any).ouriveMaterial.update({
      where: { id: material.id },
      data: { quantidadeDevolvida: { increment: parsed.data.quantidade } },
    });
    await tx.movimentacoesEstoque.create({
      data: {
        contaId: custom.contaId,
        Uid: gerarIdUnicoComMetaFinal("MOV"),
        tipo: "ENTRADA",
        ordemId: order.ordemServicoId,
        produtoId: material.produtoId,
        quantidade: parsed.data.quantidade,
        custo: material.custoSnapshot || 0,
        status: "CONCLUIDO",
      },
    });
    await event(
      tx,
      order.id,
      "MATERIAL",
      "Material devolvido ao estoque.",
      custom.userId,
      parsed.data,
    );
  });
  return ok(req, res, { materialId: material.id });
}

export async function fulfillPurchaseNeed(req: Request, res: Response) {
  const custom = own(req);
  const parsed = z
    .object({
      quantidadeComprada: z.coerce.number().positive().max(999_999),
      custoUnitarioReal: z.coerce.number().nonnegative(),
      fornecedorId: z.coerce.number().int().positive().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return fail(req, res, 422, "validation_error", "Dados da compra inválidos.");
  const need = await db.ouriveNecessidadeCompra.findFirst({
    where: { id: Number(req.params.needId), contaId: custom.contaId },
  });
  if (!need)
    return fail(req, res, 404, "purchase_need_not_found", "Necessidade de compra não encontrada.");
  if (need.status !== "PENDENTE")
    return fail(req, res, 409, "purchase_already_fulfilled", "Esta compra já foi registrada.");
  if (new Decimal(parsed.data.quantidadeComprada).lt(need.quantidadeNecessaria))
    return fail(
      req,
      res,
      422,
      "purchase_quantity_insufficient",
      "A quantidade comprada não cobre a necessidade da OS.",
    );
  if (
    ["QUANTIDADE", "PESO"].includes(need.unidade) &&
    !Number.isInteger(parsed.data.quantidadeComprada)
  )
    return fail(
      req,
      res,
      422,
      "invalid_material_measurement",
      "O estoque atual trabalha com unidades inteiras; informe uma quantidade inteira.",
    );
  const order = await orderForAccount(custom.contaId, need.ordemOuriveId);
  if (!order)
    return fail(req, res, 404, "order_not_found", "Ordem não encontrada.");
  const product = await prisma.produto.findFirst({
    where: { id: need.produtoId, contaId: custom.contaId },
    select: { id: true, nome: true },
  });
  if (!product)
    return fail(req, res, 422, "invalid_material", "Material não pertence a esta conta.");
  const stockQuantity = stockUnitsForMaterial(
    need.unidade,
    parsed.data.quantidadeComprada,
  );
  await prisma.$transaction(async (tx) => {
    await tx.produto.update({
      where: { id: product.id },
      data: { estoque: { increment: stockQuantity } },
    });
    await (tx as any).ouriveNecessidadeCompra.update({
      where: { id: need.id },
      data: {
        status: "ATENDIDA",
        quantidadeComprada: parsed.data.quantidadeComprada,
        custoUnitarioReal: money(parsed.data.custoUnitarioReal),
        fornecedorId: parsed.data.fornecedorId,
        atendidaEm: new Date(),
      },
    });
    await (tx as any).ouriveMaterial.update({
      where: { id: need.materialId },
      data: {
        necessitaCompra: false,
        medidaNecessariaCompra: 0,
        custoSnapshot: money(parsed.data.custoUnitarioReal),
      },
    });
    await tx.movimentacoesEstoque.create({
      data: {
        contaId: custom.contaId,
        Uid: gerarIdUnicoComMetaFinal("MOV"),
        tipo: "ENTRADA",
        ordemId: order.ordemServicoId,
        produtoId: product.id,
        quantidade: stockQuantity,
        custo: money(parsed.data.custoUnitarioReal),
        observacao: `Compra para a OS ${order.codigoRastreio}.`,
        status: "CONCLUIDO",
      },
    });
    await event(
      tx,
      order.id,
      "MATERIAL",
      `Compra de ${parsed.data.quantidadeComprada} ${need.unidade === "PESO" ? "g" : "un."} registrada para ${product.nome}.`,
      custom.userId,
      { necessidadeCompraId: need.id, quantidadeEstoque: stockQuantity },
    );
  });
  const remainingPurchases = await db.ouriveNecessidadeCompra.count({
    where: { ordemOuriveId: order.id, status: "PENDENTE" },
  });
  if (!remainingPurchases) {
    const approvedBudget = await db.ouriveOrcamento.findFirst({
      where: { ordemOuriveId: order.id, aprovadoEm: { not: null }, invalidoEm: null },
    });
    if (approvedBudget && order.status === "AGUARDANDO_MATERIAL")
      await db.ouriveOrdem.update({
        where: { id: order.id },
        data: { status: "PRONTA_PRODUCAO" },
      });
  }
  return ok(req, res, { necessidadeCompraId: need.id, status: "ATENDIDA" });
}

export async function finalizeMaterial(req: Request, res: Response) {
  const custom = own(req);
  const parsed = z
    .object({
      medidaUtilizada: z.coerce.number().nonnegative(),
      medidaSobra: z.coerce.number().nonnegative().default(0),
      medidaQuebra: z.coerce.number().nonnegative().default(0),
      medidaPerdaReal: z.coerce.number().nonnegative().default(0),
      observacao: z.string().max(2_000).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return fail(req, res, 422, "validation_error", "Resultado do material inválido.");
  const material = await db.ouriveMaterial.findFirst({
    where: { id: Number(req.params.materialId) },
  });
  if (!material)
    return fail(req, res, 404, "material_not_found", "Material não encontrado.");
  const order = await orderForAccount(custom.contaId, material.ordemOuriveId);
  if (!order)
    return fail(req, res, 404, "material_not_found", "Material não encontrado.");
  if (!["PRODUCAO", "REVISAO"].includes(order.status))
    return fail(
      req,
      res,
      409,
      "invalid_material_finalization",
      "O resultado do material só pode ser informado durante a produção ou revisão.",
    );
  if (material.finalizadoEm)
    return fail(req, res, 409, "material_already_finalized", "Este material já foi fechado.");
  const medidaUtilizada = new Decimal(parsed.data.medidaUtilizada).toDecimalPlaces(3);
  const medidaSobra = new Decimal(parsed.data.medidaSobra).toDecimalPlaces(3);
  const medidaQuebra = new Decimal(parsed.data.medidaQuebra).toDecimalPlaces(3);
  const medidaPerdaReal = new Decimal(parsed.data.medidaPerdaReal).toDecimalPlaces(3);
  if (
    !material.fornecidoPeloCliente &&
    [medidaUtilizada, medidaSobra, medidaQuebra, medidaPerdaReal].some(
      (medida) => !medida.isInteger(),
    )
  )
    return fail(
      req,
      res,
      422,
      "invalid_material_measurement",
      "O estoque atual trabalha com unidades inteiras; o fechamento do material da loja deve usar medidas inteiras.",
    );
  const medidaConsumida = new Decimal(material.medidaConsumida || material.medidaPlanejada);
  const totalApurado = medidaUtilizada
    .plus(medidaSobra)
    .plus(medidaQuebra)
    .plus(medidaPerdaReal);
  if (!totalApurado.minus(medidaConsumida).abs().lte(0.0005))
    return fail(
      req,
      res,
      422,
      "material_reconciliation_invalid",
      "Utilizado, sobra, quebra e perda devem totalizar o material consumido.",
      { medidaConsumida: medidaConsumida.toString(), totalApurado: totalApurado.toString() },
    );
  const stockSobra = stockUnitsForMaterial(material.unidade, medidaSobra);
  const stockQuebra = stockUnitsForMaterial(material.unidade, medidaQuebra);
  await prisma.$transaction(async (tx) => {
    if (!material.fornecidoPeloCliente && stockSobra + stockQuebra > 0)
      await tx.produto.update({
        where: { id: material.produtoId },
        data: { estoque: { increment: stockSobra + stockQuebra } },
      });
    if (!material.fornecidoPeloCliente && stockSobra > 0)
      await tx.movimentacoesEstoque.create({
        data: {
          contaId: custom.contaId,
          Uid: gerarIdUnicoComMetaFinal("MOV"),
          tipo: "ENTRADA",
          ordemId: order.ordemServicoId,
          produtoId: material.produtoId,
          quantidade: stockSobra,
          custo: material.custoSnapshot || 0,
          observacao: "Sobra reaproveitável devolvida pela OS de ourivesaria.",
          status: "CONCLUIDO",
        },
      });
    if (!material.fornecidoPeloCliente && stockQuebra > 0)
      await tx.movimentacoesEstoque.create({
        data: {
          contaId: custom.contaId,
          Uid: gerarIdUnicoComMetaFinal("MOV"),
          tipo: "ENTRADA",
          ordemId: order.ordemServicoId,
          produtoId: material.produtoId,
          quantidade: stockQuebra,
          custo: material.custoSnapshot || 0,
          observacao: "Quebra recuperável registrada pela OS de ourivesaria.",
          status: "CONCLUIDO",
        },
      });
    await (tx as any).ouriveMaterial.update({
      where: { id: material.id },
      data: {
        medidaUtilizada,
        medidaSobra,
        medidaQuebra,
        medidaPerdaReal,
        quantidadeDevolvida: stockSobra + stockQuebra,
        observacao: parsed.data.observacao,
        finalizadoEm: new Date(),
      },
    });
    await event(
      tx,
      order.id,
      "MATERIAL",
      "Resultado real do material registrado.",
      custom.userId,
      {
        materialId: material.id,
        medidaUtilizada: medidaUtilizada.toString(),
        medidaSobra: medidaSobra.toString(),
        medidaQuebra: medidaQuebra.toString(),
        medidaPerdaReal: medidaPerdaReal.toString(),
      },
    );
  });
  return ok(req, res, { materialId: material.id });
}

export async function addPiecePhoto(req: Request, res: Response) {
  const custom = own(req);
  const parsed = z
    .object({ url: z.string().url(), descricao: z.string().optional() })
    .safeParse(req.body);
  if (!parsed.success)
    return fail(req, res, 422, "validation_error", "Foto invalida.");
  const piece = await db.ourivePeca.findFirst({
    where: { id: Number(req.params.pecaId) },
  });
  if (!piece || !(await orderForAccount(custom.contaId, piece.ordemOuriveId)))
    return fail(req, res, 404, "piece_not_found", "Peca nao encontrada.");
  const photo = await db.ourivePecaFoto.create({
    data: { pecaId: piece.id, ...parsed.data },
  });
  await db.ouriveEvento.create({
    data: {
      ordemOuriveId: piece.ordemOuriveId,
      tipo: "FOTO",
      descricao: "Foto adicionada a peca sob custodia.",
      autorId: custom.userId,
      dados: { pecaId: piece.id, fotoId: photo.id },
    },
  });
  return ok(req, res, photo, 201);
}

export async function removePiecePhoto(req: Request, res: Response) {
  const custom = own(req);
  const photo = await db.ourivePecaFoto.findFirst({
    where: { id: Number(req.params.fotoId) },
  });
  if (!photo)
    return fail(req, res, 404, "photo_not_found", "Foto nao encontrada.");

  const piece = await db.ourivePeca.findFirst({ where: { id: photo.pecaId } });
  if (!piece || !(await orderForAccount(custom.contaId, piece.ordemOuriveId))) {
    return fail(req, res, 404, "photo_not_found", "Foto nao encontrada.");
  }

  await prisma.$transaction(async (tx) => {
    await (tx as any).ourivePecaFoto.delete({ where: { id: photo.id } });
    await event(
      tx,
      piece.ordemOuriveId,
      "FOTO",
      "Foto removida da peca sob custodia.",
      custom.userId,
      {
        pecaId: piece.id,
        fotoId: photo.id,
      },
    );
  });

  return ok(req, res, { fotoId: photo.id });
}

export async function deliverOrder(req: Request, res: Response) {
  const custom = own(req);
  const order = await orderForAccount(custom.contaId, Number(req.params.id));
  if (!order)
    return fail(req, res, 404, "order_not_found", "Ordem nao encontrada.");
  if (order.faturadaEm)
    return ok(req, res, {
      ordemId: order.id,
      faturadaEm: order.faturadaEm,
      idempotente: true,
    });
  if (!["REVISAO", "PRONTA_ENTREGA"].includes(order.status))
    return fail(
      req,
      res,
      409,
      "review_required",
      "A revisao aprovada e obrigatoria antes da entrega.",
    );
  if (!order.financeiroConsolidadoEm || !order.memoriaCalculoFinanceiro)
    return fail(
      req,
      res,
      409,
      "financial_consolidation_required",
      "Consolide o financeiro da OS antes da entrega.",
    );
  const pendingStages = await db.ouriveEtapa.count({
    where: { ordemOuriveId: order.id, status: { not: "APROVADA" } },
  });
  if (pendingStages)
    return fail(
      req,
      res,
      409,
      "review_required",
      "Todas as etapas devem ser aprovadas na revisao.",
    );
  const budget = await db.ouriveOrcamento.findFirst({
    where: { ordemOuriveId: order.id, invalidoEm: null },
    orderBy: { versao: "desc" },
  });
  if (!budget?.aprovadoEm)
    return fail(
      req,
      res,
      409,
      "budget_not_approved",
      "Nao ha orcamento aprovado para faturar.",
    );
  const config = await db.ouriveConfiguracao.upsert({
    where: { contaId: custom.contaId },
    create: { contaId: custom.contaId },
    update: {},
  });
  if (!config.receitaCategoriaId || !config.receitaContaFinanceiraId)
    return fail(
      req,
      res,
      422,
      "financial_configuration_required",
      "Configure categoria e conta financeira da receita do modulo Ourive.",
    );
  const commissions = await db.ouriveComissao.findMany({
    where: { ordemOuriveId: order.id, consolidadaEm: { not: null } },
  });
  if (
    commissions.length &&
    (!config.comissaoCategoriaId || !config.comissaoContaFinanceiraId)
  )
    return fail(
      req,
      res,
      422,
      "financial_configuration_required",
      "Configure categoria e conta financeira das comissoes do modulo Ourive.",
    );
  const base = await prisma.ordensServico.findFirstOrThrow({
    where: { id: order.ordemServicoId, contaId: custom.contaId },
  });
  const serviceValue = (Array.isArray(budget.servicos) ? budget.servicos : []).reduce(
    (total: Decimal, service: any) =>
      total.plus(money(service.quantidade).mul(money(service.valor))),
    new Decimal(0),
  );
  const materials = await db.ouriveMaterial.findMany({
    where: { ordemOuriveId: order.id },
    select: {
      quantidadePlanejada: true,
      quantidadeConsumida: true,
      quantidadeDevolvida: true,
      medidaConsumida: true,
      medidaUtilizada: true,
      medidaSobra: true,
      medidaQuebra: true,
      medidaPerdaReal: true,
      finalizadoEm: true,
      fornecidoPeloCliente: true,
      valorUnitario: true,
      custoSnapshot: true,
    },
  });
  const materialValue = materials.reduce(
    (total: Decimal, material: any) =>
      material.fornecidoPeloCliente
        ? total
        : total.plus(money(material.valorUnitario).mul(material.quantidadePlanejada)),
    new Decimal(0),
  );
  const valorBruto = serviceValue.plus(materialValue);
  const desconto = money(budget.desconto);
  const custoMaterialLoja = materials.reduce(
    (total: Decimal, material: any) => {
      if (material.fornecidoPeloCliente) return total;
      const medidaLiquidada = material.finalizadoEm
        ? new Decimal(material.medidaUtilizada || 0).plus(material.medidaPerdaReal || 0)
        : new Decimal(material.medidaConsumida || 0)
            .minus(material.medidaSobra || 0)
            .minus(material.medidaQuebra || 0);
      const quantidadeUtilizada = medidaLiquidada.greaterThan(0)
        ? medidaLiquidada
        : new Decimal(
            Math.max(
              0,
              Number(material.quantidadeConsumida) - Number(material.quantidadeDevolvida),
            ),
          );
      return total.plus(money(material.custoSnapshot || 0).mul(quantidadeUtilizada));
    },
    new Decimal(0),
  );
  const memoriaCalculoFinanceiro = order.memoriaCalculoFinanceiro as any;
  const result = await prisma.$transaction(async (tx) => {
    const reserved = await (tx as any).ouriveOrdem.updateMany({
      where: { id: order.id, faturadaEm: null },
      data: {
        faturadaEm: new Date(),
        entregueEm: new Date(),
        status: "ENTREGUE",
        financeiroStatus: order.financeiroStatus,
      },
    });
    if (!reserved.count) return { idempotente: true };
    const revenue = await tx.lancamentoFinanceiro.create({
      data: {
        contaId: custom.contaId,
        Uid: gerarIdUnicoComMetaFinal("FIN"),
        descricao: `Receita Ourive ${order.codigoRastreio}`,
        valorBruto,
        valorTotal: money(budget.valorFinal),
        desconto,
        tipo: "RECEITA",
        formaPagamento: "OUTRO",
        status: "PENDENTE",
        dataLancamento: new Date(),
        clienteId: base.clienteId,
        categoriaId: config.receitaCategoriaId,
        contasFinanceiroId: config.receitaContaFinanceiraId,
        parcelas: {
          create: {
            Uid: gerarIdUnicoComMetaFinal("PAR"),
            numero: 1,
            valor: money(budget.valorFinal),
            vencimento: new Date(),
            pago: false,
          },
        },
      },
    });
    await (tx as any).ouriveOrdem.update({
      where: { id: order.id },
      data: { receitaLancamentoId: revenue.id },
    });
    for (const commission of commissions) {
      if (commission.lancamentoFinanceiroId || !commission.valorConsolidado)
        continue;
      const expense = await tx.lancamentoFinanceiro.create({
        data: {
          contaId: custom.contaId,
          Uid: gerarIdUnicoComMetaFinal("FIN"),
          descricao: `Comissao Ourive ${order.codigoRastreio} - etapa ${commission.etapaId}`,
          valorBruto: money(commission.valorConsolidado),
          valorTotal: money(commission.valorConsolidado),
          desconto: 0,
          tipo: "DESPESA",
          formaPagamento: "OUTRO",
          status: "PENDENTE",
          dataLancamento: new Date(),
          categoriaId: config.comissaoCategoriaId,
          contasFinanceiroId: config.comissaoContaFinanceiraId,
          parcelas: {
            create: {
              Uid: gerarIdUnicoComMetaFinal("PAR"),
              numero: 1,
              valor: money(commission.valorConsolidado),
              vencimento: new Date(),
              pago: false,
            },
          },
        },
      });
      await (tx as any).ouriveComissao.update({
        where: { id: commission.id },
        data: { lancamentoFinanceiroId: expense.id },
      });
    }
    await tx.ordensServico.update({
      where: { id: base.id },
      data: { status: "FATURADA" },
    });
    await event(
      tx,
      order.id,
      "FINANCEIRO",
      "Entrega faturada; receita e comissoes pendentes geradas.",
      custom.userId,
      {
        receitaLancamentoId: revenue.id,
        memoriaCalculoFinanceiro,
      },
    );
    await event(
      tx,
      order.id,
      "ENTREGA",
      "Peca entregue ao cliente.",
      custom.userId,
    );
    return { revenueId: revenue.id, idempotente: false };
  });
  return ok(req, res, { ordemId: order.id, ...result });
}

export async function cancelOrder(req: Request, res: Response) {
  const custom = own(req);
  const parsed = z.object({ motivo: z.string().min(3) }).safeParse(req.body);
  if (!parsed.success)
    return fail(
      req,
      res,
      422,
      "validation_error",
      "Informe o motivo do cancelamento.",
    );
  const order = await orderForAccount(custom.contaId, Number(req.params.id));
  if (!order)
    return fail(req, res, 404, "order_not_found", "Ordem nao encontrada.");
  if (["ENTREGUE", "RECUSADA", "CANCELADA"].includes(order.status))
    return fail(req, res, 409, "order_closed", "A ordem ja esta encerrada.");
  const materials = await db.ouriveMaterial.findMany({
    where: { ordemOuriveId: order.id },
    select: {
      quantidadeConsumida: true,
      quantidadeDevolvida: true,
      fornecidoPeloCliente: true,
    },
  });
  if (
    materials.some(
      (material: any) =>
        !material.fornecidoPeloCliente &&
        material.quantidadeConsumida !== material.quantidadeDevolvida,
    )
  )
    return fail(
      req,
      res,
      409,
      "materials_return_required",
      "Registre a devolucao total dos materiais consumidos antes de cancelar.",
    );
  await prisma.$transaction(async (tx) => {
    await (tx as any).ouriveOrdem.update({
      where: { id: order.id },
      data: { status: "CANCELADA" },
    });
    await tx.ordensServico.update({
      where: { id: order.ordemServicoId },
      data: { status: "CANCELADA" },
    });
    await event(
      tx,
      order.id,
      "CANCELAMENTO",
      parsed.data.motivo,
      custom.userId,
    );
  });
  return ok(req, res, { ordemId: order.id, status: "CANCELADA" });
}

export async function deleteOrder(req: Request, res: Response) {
  const custom = own(req);
  const order = await orderForAccount(custom.contaId, Number(req.params.id));
  if (!order)
    return fail(req, res, 404, "order_not_found", "Ordem nao encontrada.");
  if (order.faturadaEm || order.receitaLancamentoId)
    return fail(
      req,
      res,
      409,
      "order_has_financial_history",
      "Uma ordem faturada nao pode ser apagada.",
    );
  const [materials, commissions, movements] = await Promise.all([
    db.ouriveMaterial.findMany({
      where: { ordemOuriveId: order.id },
      select: { quantidadeConsumida: true },
    }),
    db.ouriveComissao.count({
      where: { ordemOuriveId: order.id, lancamentoFinanceiroId: { not: null } },
    }),
    prisma.movimentacoesEstoque.count({
      where: { contaId: custom.contaId, ordemId: order.ordemServicoId },
    }),
  ]);
  if (materials.some((material: any) => material.quantidadeConsumida > 0) || movements || commissions)
    return fail(
      req,
      res,
      409,
      "order_has_inventory_or_financial_history",
      "Não é possível apagar uma ordem com movimentação de estoque ou lançamento financeiro.",
    );

  await prisma.$transaction(async (tx) => {
    const pieces = await (tx as any).ourivePeca.findMany({
      where: { ordemOuriveId: order.id },
      select: { id: true },
    });
    const stages = await (tx as any).ouriveEtapa.findMany({
      where: { ordemOuriveId: order.id },
      select: { id: true },
    });
    await (tx as any).ourivePecaFoto.deleteMany({
      where: { pecaId: { in: pieces.map((piece: any) => piece.id) } },
    });
    await (tx as any).ouriveEtapaResponsavel.deleteMany({
      where: { etapaId: { in: stages.map((stage: any) => stage.id) } },
    });
    await (tx as any).ouriveComissao.deleteMany({ where: { ordemOuriveId: order.id } });
    await (tx as any).ouriveEtapa.deleteMany({ where: { ordemOuriveId: order.id } });
    await (tx as any).ouriveMaterial.deleteMany({ where: { ordemOuriveId: order.id } });
    await (tx as any).ouriveEvento.deleteMany({ where: { ordemOuriveId: order.id } });
    await (tx as any).ouriveOrcamento.deleteMany({ where: { ordemOuriveId: order.id } });
    await (tx as any).ourivePeca.deleteMany({ where: { ordemOuriveId: order.id } });
    await tx.itensOrdensServico.deleteMany({ where: { ordemId: order.ordemServicoId } });
    await (tx as any).ouriveOrdem.delete({ where: { id: order.id } });
    await tx.ordensServico.delete({ where: { id: order.ordemServicoId } });
  });
  return ok(req, res, { ordemId: order.id, apagada: true });
}

export async function addExtraCost(req: Request, res: Response) {
  const custom = own(req);
  const parsed = z
    .object({
      valor: z.coerce.number().positive(),
      descricao: z.string().min(3).max(500),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return fail(
      req,
      res,
      422,
      "validation_error",
      "Custo extra invalido.",
      parsed.error.flatten(),
    );
  const order = await orderForAccount(custom.contaId, Number(req.params.id));
  if (!order)
    return fail(req, res, 404, "order_not_found", "Ordem nao encontrada.");
  if (["ENTREGUE", "RECUSADA", "CANCELADA"].includes(order.status))
    return fail(req, res, 409, "order_closed", "A ordem esta encerrada.");
  await prisma.$transaction(async (tx) => {
    await (tx as any).ouriveOrdem.update({
      where: { id: order.id },
      data: { custoExtra: { increment: money(parsed.data.valor) } },
    });
    await event(
      tx,
      order.id,
      "CUSTO_EXTRA",
      parsed.data.descricao,
      custom.userId,
      { valor: money(parsed.data.valor).toString() },
    );
  });
  return ok(req, res, { ordemId: order.id });
}

export async function settleCommission(req: Request, res: Response) {
  const custom = own(req);
  const commission = await db.ouriveComissao.findFirst({
    where: { id: Number(req.params.id) },
  });
  if (!commission)
    return fail(
      req,
      res,
      404,
      "commission_not_found",
      "Comissao nao encontrada.",
    );
  const order = await orderForAccount(custom.contaId, commission.ordemOuriveId);
  if (!order)
    return fail(
      req,
      res,
      404,
      "commission_not_found",
      "Comissao nao encontrada.",
    );
  if (!commission.lancamentoFinanceiroId || !commission.valorConsolidado)
    return fail(
      req,
      res,
      409,
      "commission_not_ready",
      "A comissao ainda nao esta disponivel para quitacao.",
    );
  if (commission.quitadaEm)
    return ok(req, res, {
      comissaoId: commission.id,
      quitadaEm: commission.quitadaEm,
      idempotente: true,
    });
  const paidAt = new Date();
  await prisma.$transaction(async (tx) => {
    const reserved = await (tx as any).ouriveComissao.updateMany({
      where: { id: commission.id, quitadaEm: null },
      data: { quitadaEm: paidAt },
    });
    if (!reserved.count) return;
    await tx.parcelaFinanceiro.updateMany({
      where: { lancamentoId: commission.lancamentoFinanceiroId },
      data: {
        pago: true,
        valorPago: money(commission.valorConsolidado),
        formaPagamento: "OUTRO",
        dataPagamento: paidAt,
      },
    });
    await tx.lancamentoFinanceiro.update({
      where: { id: commission.lancamentoFinanceiroId },
      data: { status: "PAGO", dataEntrada: paidAt },
    });
    await event(
      tx,
      order.id,
      "FINANCEIRO",
      "Comissao quitada.",
      custom.userId,
      {
        comissaoId: commission.id,
        lancamentoFinanceiroId: commission.lancamentoFinanceiroId,
      },
    );
  });
  return ok(req, res, { comissaoId: commission.id, quitadaEm: paidAt });
}

export async function listOuriveTransfers(req: Request, res: Response) {
  const custom = own(req);
  const status = z.enum(["PENDENTE", "PAGO", "CANCELADO"]).safeParse(req.query.status);
  const repasses = await db.ouriveRepasse.findMany({
    where: {
      contaId: custom.contaId,
      ...(status.success ? { status: status.data } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  const [users, orders] = await Promise.all([
    prisma.usuarios.findMany({
      where: {
        contaId: custom.contaId,
        id: { in: [...new Set(repasses.map((item: any) => item.usuarioId))] },
      },
      select: { id: true, nome: true },
    }),
    db.ouriveOrdem.findMany({
      where: {
        contaId: custom.contaId,
        id: { in: [...new Set(repasses.map((item: any) => item.ordemOuriveId))] },
      },
      select: { id: true, codigoRastreio: true, ordemServicoId: true },
    }),
  ]);
  const bases = await prisma.ordensServico.findMany({
    where: { contaId: custom.contaId, id: { in: orders.map((item: any) => item.ordemServicoId) } },
    include: { Cliente: { select: { nome: true } } },
  });
  return ok(
    req,
    res,
    repasses.map((repasse: any) => {
      const order = orders.find((item: any) => item.id === repasse.ordemOuriveId);
      const base = bases.find((item) => item.id === order?.ordemServicoId);
      return {
        ...repasse,
        usuario: users.find((item) => item.id === repasse.usuarioId),
        ordem: order
          ? { id: order.id, codigoRastreio: order.codigoRastreio, cliente: base?.Cliente }
          : undefined,
      };
    }),
  );
}

export async function listOurivePayments(req: Request, res: Response) {
  const custom = own(req);
  const payments = await db.ourivePagamento.findMany({
    where: { contaId: custom.contaId },
    orderBy: { dataPagamento: "desc" },
  });
  const [users, items] = await Promise.all([
    prisma.usuarios.findMany({
      where: {
        contaId: custom.contaId,
        id: { in: [...new Set(payments.map((item: any) => item.usuarioId))] },
      },
      select: { id: true, nome: true },
    }),
    db.ourivePagamentoItem.findMany({
      where: { pagamentoId: { in: payments.map((item: any) => item.id) } },
    }),
  ]);
  return ok(
    req,
    res,
    payments.map((payment: any) => ({
      ...payment,
      usuario: users.find((item) => item.id === payment.usuarioId),
      itens: items.filter((item: any) => item.pagamentoId === payment.id),
    })),
  );
}

export async function createOurivePayment(req: Request, res: Response) {
  const custom = own(req);
  const parsed = z
    .object({
      repasseIds: z.array(z.coerce.number().int().positive()).min(1),
      dataPagamento: z.coerce.date().default(() => new Date()),
      observacao: z.string().max(2000).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Pagamento inválido.");
  const repasseIds = [...new Set(parsed.data.repasseIds)];
  const repasses = await db.ouriveRepasse.findMany({
    where: { id: { in: repasseIds }, contaId: custom.contaId, status: "PENDENTE" },
  });
  if (repasses.length !== repasseIds.length)
    return fail(req, res, 409, "transfer_unavailable", "Um dos repasses não está mais pendente.");
  const usuarioIds = [...new Set(repasses.map((item: any) => item.usuarioId))];
  if (usuarioIds.length !== 1)
    return fail(req, res, 422, "mixed_payees", "Selecione repasses de um único ourives.");
  const config = await db.ouriveConfiguracao.findUnique({ where: { contaId: custom.contaId } });
  if (!config?.comissaoCategoriaId || !config?.comissaoContaFinanceiraId)
    return fail(req, res, 422, "financial_configuration_required", "Configure categoria e conta de pagamentos dos ourives.");
  const total = repasses.reduce(
    (sum: Decimal, repasse: any) => sum.plus(repasse.valor),
    new Decimal(0),
  );
  const result = await prisma.$transaction(async (tx) => {
    const reserved = await (tx as any).ouriveRepasse.updateMany({
      where: { id: { in: repasseIds }, status: "PENDENTE" },
      data: { status: "PAGO", pagoEm: parsed.data.dataPagamento },
    });
    if (reserved.count !== repasseIds.length) throw new Error("transfer_unavailable");
    const launch = await tx.lancamentoFinanceiro.create({
      data: {
        contaId: custom.contaId,
        Uid: gerarIdUnicoComMetaFinal("FIN"),
        descricao: `Pagamento agrupado ao ourives #${usuarioIds[0]}`,
        valorBruto: money(total),
        valorTotal: money(total),
        desconto: 0,
        tipo: "DESPESA",
        formaPagamento: "OUTRO",
        status: "PAGO",
        dataLancamento: parsed.data.dataPagamento,
        dataEntrada: parsed.data.dataPagamento,
        categoriaId: config.comissaoCategoriaId,
        contasFinanceiroId: config.comissaoContaFinanceiraId,
        parcelas: {
          create: {
            Uid: gerarIdUnicoComMetaFinal("PAR"),
            numero: 1,
            valor: money(total),
            vencimento: parsed.data.dataPagamento,
            pago: true,
            valorPago: money(total),
            formaPagamento: "OUTRO",
            dataPagamento: parsed.data.dataPagamento,
          },
        },
      },
    });
    const payment = await (tx as any).ourivePagamento.create({
      data: {
        contaId: custom.contaId,
        usuarioId: usuarioIds[0],
        valorTotal: money(total),
        dataPagamento: parsed.data.dataPagamento,
        observacao: parsed.data.observacao,
        lancamentoFinanceiroId: launch.id,
        criadoPorId: custom.userId,
      },
    });
    await (tx as any).ourivePagamentoItem.createMany({
      data: repasses.map((repasse: any) => ({
        pagamentoId: payment.id,
        repasseId: repasse.id,
        ordemOuriveId: repasse.ordemOuriveId,
        valor: repasse.valor,
      })),
    });
    for (const orderId of [...new Set(repasses.map((item: any) => item.ordemOuriveId))]) {
      const orderPayment = repasses
        .filter((item: any) => item.ordemOuriveId === orderId)
        .reduce((sum: Decimal, item: any) => sum.plus(item.valor), new Decimal(0));
      const remaining = await (tx as any).ouriveRepasse.count({
        where: { ordemOuriveId: orderId, status: "PENDENTE" },
      });
      if (!remaining)
        await (tx as any).ouriveOrdem.update({
          where: { id: orderId },
          data: { financeiroStatus: "PAGO" },
        });
      await event(tx, orderId, "PAGAMENTO", "Repasse ao ourives pago em lote.", custom.userId, {
        pagamentoId: payment.id,
        valor: money(orderPayment).toFixed(2),
      });
    }
    return { payment, launch };
  });
  return ok(req, res, { pagamentoId: result.payment.id, valorTotal: money(total).toFixed(2) }, 201);
}

export async function listProLabore(req: Request, res: Response) {
  const custom = own(req);
  const rows = await db.ouriveProLabore.findMany({
    where: { contaId: custom.contaId },
    orderBy: [{ competencia: "desc" }, { createdAt: "desc" }],
  });
  const users = await prisma.usuarios.findMany({
    where: {
      contaId: custom.contaId,
      id: { in: [...new Set(rows.map((item: any) => item.beneficiarioId))] },
    },
    select: { id: true, nome: true },
  });
  return ok(req, res, rows.map((row: any) => ({ ...row, beneficiario: users.find((user) => user.id === row.beneficiarioId) })));
}

export async function createProLabore(req: Request, res: Response) {
  const custom = own(req);
  const parsed = z
    .object({
      beneficiarioId: z.coerce.number().int().positive(),
      competencia: z.coerce.date(),
      valor: z.coerce.number().positive(),
      observacao: z.string().max(2000).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Pró-labore inválido.");
  const [beneficiary, config] = await Promise.all([
    prisma.usuarios.findFirst({
      where: { id: parsed.data.beneficiarioId, contaId: custom.contaId },
      select: { id: true, nome: true },
    }),
    db.ouriveConfiguracao.findUnique({ where: { contaId: custom.contaId } }),
  ]);
  if (!beneficiary) return fail(req, res, 422, "invalid_beneficiary", "Beneficiário inválido.");
  if (!config?.proLaboreCategoriaId || !config?.proLaboreContaFinanceiraId)
    return fail(req, res, 422, "financial_configuration_required", "Configure categoria e conta do pró-labore.");
  const competenceStart = new Date(parsed.data.competencia);
  competenceStart.setDate(1);
  competenceStart.setHours(0, 0, 0, 0);
  const competenceEnd = new Date(competenceStart);
  competenceEnd.setMonth(competenceEnd.getMonth() + 1);
  const duplicate = await db.ouriveProLabore.findFirst({
    where: {
      contaId: custom.contaId,
      beneficiarioId: beneficiary.id,
      competencia: { gte: competenceStart, lt: competenceEnd },
      status: { in: ["PENDENTE", "PAGO"] },
    },
  });
  if (duplicate)
    return fail(
      req,
      res,
      409,
      "pro_labore_already_exists",
      "Já existe pró-labore para este beneficiário nessa competência.",
    );
  const result = await prisma.$transaction(async (tx) => {
    const launch = await tx.lancamentoFinanceiro.create({
      data: {
        contaId: custom.contaId,
        Uid: gerarIdUnicoComMetaFinal("FIN"),
        descricao: `Pró-labore ${beneficiary.nome} - ${parsed.data.competencia.toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}`,
        valorBruto: money(parsed.data.valor),
        valorTotal: money(parsed.data.valor),
        desconto: 0,
        tipo: "DESPESA",
        formaPagamento: "OUTRO",
        status: "PENDENTE",
        dataLancamento: new Date(),
        categoriaId: config.proLaboreCategoriaId,
        contasFinanceiroId: config.proLaboreContaFinanceiraId,
        parcelas: {
          create: {
            Uid: gerarIdUnicoComMetaFinal("PAR"),
            numero: 1,
            valor: money(parsed.data.valor),
            vencimento: parsed.data.competencia,
            pago: false,
          },
        },
      },
    });
    const row = await (tx as any).ouriveProLabore.create({
      data: {
        contaId: custom.contaId,
        beneficiarioId: beneficiary.id,
        competencia: parsed.data.competencia,
        valor: money(parsed.data.valor),
        observacao: parsed.data.observacao,
        lancamentoFinanceiroId: launch.id,
        criadoPorId: custom.userId,
      },
    });
    return row;
  });
  return ok(req, res, result, 201);
}

export async function payProLabore(req: Request, res: Response) {
  const custom = own(req);
  const row = await db.ouriveProLabore.findFirst({
    where: { id: Number(req.params.id), contaId: custom.contaId },
  });
  if (!row) return fail(req, res, 404, "pro_labore_not_found", "Pró-labore não encontrado.");
  if (row.status === "PAGO") return ok(req, res, { id: row.id, idempotente: true });
  if (row.status !== "PENDENTE") return fail(req, res, 409, "pro_labore_unavailable", "Pró-labore não está pendente.");
  const paidAt = new Date();
  await prisma.$transaction(async (tx) => {
    await (tx as any).ouriveProLabore.update({
      where: { id: row.id },
      data: { status: "PAGO", dataPagamento: paidAt },
    });
    if (row.lancamentoFinanceiroId) {
      await tx.lancamentoFinanceiro.update({
        where: { id: row.lancamentoFinanceiroId },
        data: { status: "PAGO", dataEntrada: paidAt },
      });
      await tx.parcelaFinanceiro.updateMany({
        where: { lancamentoId: row.lancamentoFinanceiroId },
        data: {
          pago: true,
          valorPago: row.valor,
          formaPagamento: "OUTRO",
          dataPagamento: paidAt,
        },
      });
    }
  });
  return ok(req, res, { id: row.id, dataPagamento: paidAt });
}

export async function dashboard(req: Request, res: Response) {
  const custom = own(req);
  const access = await getOuriveAccess(custom);
  const now = new Date();
  const requestedStart = req.query.inicio
    ? new Date(String(req.query.inicio))
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const requestedEnd = req.query.fim ? new Date(String(req.query.fim)) : now;
  const inicio = Number.isNaN(requestedStart.getTime())
    ? new Date(now.getFullYear(), now.getMonth(), 1)
    : requestedStart;
  const fim = Number.isNaN(requestedEnd.getTime()) ? now : requestedEnd;
  const rangeMs = Math.max(86_400_000, fim.getTime() - inicio.getTime() + 1);
  const inicioAnterior = new Date(inicio.getTime() - rangeMs);
  const fimAnterior = new Date(inicio.getTime() - 1);
  const where: any = { contaId: custom.contaId };
  if (
    access.papeis.includes("OURIVE") &&
    !access.capabilities.includes("CONFIGURAR")
  ) {
    const assigned = await db.ouriveEtapaResponsavel.findMany({
      where: { usuarioId: custom.userId },
      select: { etapaId: true },
    });
    const assignedStages = await db.ouriveEtapa.findMany({
      where: { id: { in: assigned.map((item: any) => item.etapaId) } },
      select: { ordemOuriveId: true },
    });
    where.id = {
      in: [...new Set(assignedStages.map((item: any) => item.ordemOuriveId))],
    };
  }
  const orders = await db.ouriveOrdem.findMany({
    where,
    select: {
      id: true,
      codigoRastreio: true,
      status: true,
      createdAt: true,
      entregueEm: true,
      prazoPrevisto: true,
      producaoIniciadaEm: true,
      producaoFinalizadaEm: true,
    },
  });
  const orderIds = orders.map((item: any) => item.id);
  const [budgets, stages, commissions, pendingTransfers, pendingPurchases] = await Promise.all([
    db.ouriveOrcamento.findMany({
      where: { ordemOuriveId: { in: orderIds }, aprovadoEm: { not: null } },
      select: { ordemOuriveId: true, valorFinal: true, aprovadoEm: true },
    }),
    db.ouriveEtapa.findMany({
      where: {
        ordemOuriveId: { in: orderIds },
        status: {
          in: ["PENDENTE", "EM_EXECUCAO", "AGUARDANDO_REVISAO", "REPROVADA"],
        },
      },
      orderBy: { prazoPrevisto: "asc" },
      take: 15,
    }),
    db.ouriveComissao.aggregate({
      where: {
        ordemOuriveId: { in: orderIds },
        ...(access.capabilities.includes("CONFIGURAR")
          ? {}
          : { usuarioId: custom.userId }),
        consolidadaEm: { not: null },
      },
      _sum: { valorConsolidado: true },
    }),
    db.ouriveRepasse.aggregate({
      where: {
        contaId: custom.contaId,
        status: "PENDENTE",
        ...(access.capabilities.includes("CONFIGURAR") ? {} : { usuarioId: custom.userId }),
      },
      _sum: { valor: true },
    }),
    db.ouriveNecessidadeCompra.count({
      where: { contaId: custom.contaId, status: "PENDENTE" },
    }),
  ]);
  const inRange = (value: Date | null | undefined, start: Date, end: Date) =>
    Boolean(value && value >= start && value <= end);
  const sum = (items: any[]) =>
    items
      .reduce((total, item) => total.plus(item.valorFinal || 0), new Decimal(0))
      .toNumber();
  const metric = (atual: number, anterior: number) => ({
    atual,
    anterior,
    delta: anterior ? ((atual - anterior) / anterior) * 100 : atual ? 100 : 0,
  });
  const budgetsCurrent = budgets.filter((budget: any) =>
    inRange(budget.aprovadoEm, inicio, fim),
  );
  const budgetsPrevious = budgets.filter((budget: any) =>
    inRange(budget.aprovadoEm, inicioAnterior, fimAnterior),
  );
  const ordersCurrent = orders.filter((order: any) =>
    inRange(order.createdAt, inicio, fim),
  );
  const ordersPrevious = orders.filter((order: any) =>
    inRange(order.createdAt, inicioAnterior, fimAnterior),
  );
  const revenueCurrent = sum(budgetsCurrent);
  const revenuePrevious = sum(budgetsPrevious);
  const ticketCurrent = budgetsCurrent.length
    ? revenueCurrent / budgetsCurrent.length
    : 0;
  const ticketPrevious = budgetsPrevious.length
    ? sum(budgetsPrevious) / budgetsPrevious.length
    : 0;
  const deliveries = orders.filter((order: any) =>
    inRange(order.entregueEm, inicio, fim),
  );
  const averageDeliveryDays = deliveries.length
    ? deliveries.reduce(
        (total: number, order: any) =>
          total +
          (order.entregueEm.getTime() - order.createdAt.getTime()) / 86_400_000,
        0,
      ) / deliveries.length
    : 0;
  const statusOrder = [
    "RECEBIDA",
    "ORCAMENTO",
    "AGUARDANDO_MATERIAL",
    "PRONTA_PRODUCAO",
    "PRODUCAO",
    "FINALIZADA",
    "REVISAO",
    "PRONTA_ENTREGA",
    "ENTREGUE",
    "RECUSADA",
    "CANCELADA",
  ];
  const statusData = statusOrder.map(
    (status) => orders.filter((order: any) => order.status === status).length,
  );
  const daily = new Map<string, number>();
  for (
    let cursor = new Date(inicio);
    cursor <= fim;
    cursor.setDate(cursor.getDate() + 1)
  )
    daily.set(cursor.toISOString().slice(0, 10), 0);
  budgetsCurrent.forEach((budget: any) => {
    const key = budget.aprovadoEm.toISOString().slice(0, 10);
    daily.set(key, (daily.get(key) || 0) + Number(budget.valorFinal || 0));
  });
  const orderById = new Map(orders.map((order: any) => [order.id, order]));
  return ok(req, res, {
    kpis: {
      receita: metric(revenueCurrent, revenuePrevious),
      ordens: metric(ordersCurrent.length, ordersPrevious.length),
      ticketMedio: metric(ticketCurrent, ticketPrevious),
      entregas: {
        atual: deliveries.length,
        prazoMedioDias: averageDeliveryDays,
      },
      emProducao: orders.filter((order: any) =>
        ["PRODUCAO", "REVISAO"].includes(order.status),
      ).length,
      aguardandoOrcamento: orders.filter((order: any) =>
        ["RECEBIDA", "ORCAMENTO"].includes(order.status),
      ).length,
      comissoes: Number(commissions._sum.valorConsolidado || 0),
      aguardandoMaterial: orders.filter((order: any) => order.status === "AGUARDANDO_MATERIAL").length,
      comprasPendentes: pendingPurchases,
      atrasadas: orders.filter(
        (order: any) =>
          order.prazoPrevisto &&
          order.prazoPrevisto < now &&
          !["ENTREGUE", "RECUSADA", "CANCELADA"].includes(order.status),
      ).length,
      prontasEntrega: orders.filter((order: any) => order.status === "PRONTA_ENTREGA").length,
      valorPendenteOurives: Number(pendingTransfers._sum.valor || 0),
    },
    serieReceita: {
      labels: [...daily.keys()].map((date) =>
        new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
        }),
      ),
      data: [...daily.values()],
    },
    porStatus: { labels: statusOrder, data: statusData },
    filaEtapas: stages.map((stage: any) => ({
      ...stage,
      ordem: orderById.get(stage.ordemOuriveId),
    })),
  });
}

export async function listCommissions(req: Request, res: Response) {
  const custom = own(req);
  const access = await getOuriveAccess(custom);
  const orderIds = (
    await db.ouriveOrdem.findMany({
      where: { contaId: custom.contaId },
      select: { id: true },
    })
  ).map((item: any) => item.id);
  const rows = await db.ouriveComissao.findMany({
    where: {
      ordemOuriveId: { in: orderIds },
      ...(access.capabilities.includes("CONFIGURAR")
        ? {}
        : { usuarioId: custom.userId }),
    },
    orderBy: { createdAt: "desc" },
  });
  const users = await prisma.usuarios.findMany({
    where: {
      contaId: custom.contaId,
      id: { in: [...new Set(rows.map((item: any) => item.usuarioId))] },
    },
    select: { id: true, nome: true },
  });
  const data = rows.map((row: any) => ({
      ...row,
      usuario: users.find((user) => user.id === row.usuarioId),
    }));
  if (req.query.pageSize !== undefined) {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 10)));
    const search = String(req.query.search || '').trim().toLowerCase();
    const filtered = search
      ? data.filter((row: any) => `${row.usuario?.nome || ''} ${row.tipo} ${row.etapaId}`.toLowerCase().includes(search))
      : data;
    const total = filtered.length;
    return res.json({ data: filtered.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  }
  return ok(req, res, data);
}

export async function report(req: Request, res: Response) {
  const custom = own(req);
  const filters = z
    .object({
      status: operationalStatusSchema.optional(),
      tipo: z.enum(["CONSERTO", "ENCOMENDA"]).optional(),
      clienteId: z.coerce.number().int().positive().optional(),
      ouriveId: z.coerce.number().int().positive().optional(),
    })
    .safeParse(req.query);
  if (!filters.success)
    return fail(req, res, 422, "validation_error", "Filtros do relatório inválidos.");
  const dateRange =
    req.query.inicio || req.query.fim
      ? {
          ...(req.query.inicio ? { gte: new Date(String(req.query.inicio)) } : {}),
          ...(req.query.fim ? { lte: new Date(String(req.query.fim)) } : {}),
        }
      : undefined;
  const [clientOrderIds, goldsmithOrderIds] = await Promise.all([
    filters.data.clienteId
      ? prisma.ordensServico
          .findMany({
            where: { contaId: custom.contaId, clienteId: filters.data.clienteId },
            select: { id: true },
          })
          .then((rows) => rows.map((row) => row.id))
      : undefined,
    filters.data.ouriveId
      ? db.ouriveEtapaResponsavel
          .findMany({
            where: { usuarioId: filters.data.ouriveId },
            select: { etapaId: true },
          })
          .then(async (links: any[]) => {
            const stages = await db.ouriveEtapa.findMany({
              where: { id: { in: links.map((link: any) => link.etapaId) } },
              select: { ordemOuriveId: true },
            });
            return [...new Set(stages.map((stage: any) => stage.ordemOuriveId))];
          })
      : undefined,
  ]);
  const filteredOrderWhere: any = {
    contaId: custom.contaId,
    ...(filters.data.status ? { status: filters.data.status } : {}),
    ...(filters.data.tipo ? { tipo: filters.data.tipo } : {}),
    ...(clientOrderIds ? { ordemServicoId: { in: clientOrderIds } } : {}),
    ...(goldsmithOrderIds ? { id: { in: goldsmithOrderIds } } : {}),
  };
  // As quantidades por status representam recebimentos do período. Já receita
  // e custos consideram exclusivamente OS faturadas no período, evitando que
  // um orçamento aprovado infle o resultado antes da entrega.
  const [orders, billedOrders, statusRows] = await Promise.all([
    db.ouriveOrdem.findMany({
      where: { ...filteredOrderWhere, ...(dateRange ? { createdAt: dateRange } : {}) },
    }),
    db.ouriveOrdem.findMany({
      where: {
        ...filteredOrderWhere,
        faturadaEm: dateRange ? dateRange : { not: null },
      },
    }),
    db.ouriveOrdem.groupBy({
      by: ["status"],
      where: { ...filteredOrderWhere, ...(dateRange ? { createdAt: dateRange } : {}) },
      _count: { _all: true },
    }),
  ]);
  const billedIds = billedOrders.map((order: any) => order.id);
  const budgets = await db.ouriveOrcamento.findMany({
    where: {
      ordemOuriveId: { in: billedIds },
      aprovadoEm: { not: null },
      invalidoEm: null,
    },
  });
  const materials = await db.ouriveMaterial.findMany({
    where: { ordemOuriveId: { in: billedIds } },
  });
  const operationalMaterials = await db.ouriveMaterial.findMany({
    where: { ordemOuriveId: { in: orders.map((order: any) => order.id) } },
  });
  const commissions = await db.ouriveComissao.findMany({
    where: {
      ordemOuriveId: { in: billedIds },
      consolidadaEm: { not: null },
    },
  });
  const allFilteredOrderIds = (
    await db.ouriveOrdem.findMany({
      where: filteredOrderWhere,
      select: { id: true },
    })
  ).map((order: any) => order.id);
  const [repasses, paymentItems, proLabore] = await Promise.all([
    db.ouriveRepasse.findMany({
      where: {
        contaId: custom.contaId,
        ordemOuriveId: { in: allFilteredOrderIds },
      },
    }),
    db.ourivePagamentoItem.findMany({
      where: { ordemOuriveId: { in: allFilteredOrderIds } },
      select: { pagamentoId: true, valor: true },
    }),
    db.ouriveProLabore.findMany({
      where: { contaId: custom.contaId, ...(dateRange ? { competencia: dateRange } : {}) },
    }),
  ]);
  const payments = await db.ourivePagamento.findMany({
    where: {
      contaId: custom.contaId,
      id: { in: [...new Set(paymentItems.map((item: any) => item.pagamentoId))] },
      ...(dateRange ? { dataPagamento: dateRange } : {}),
    },
  });
  const revenue = budgets.reduce(
    (total: Decimal, budget: any) => total.plus(budget.valorFinal),
    new Decimal(0),
  );
  const materialCost = materials.reduce(
    (total: Decimal, material: any) =>
      material.fornecidoPeloCliente
        ? total
        : total.plus(
            money(material.custoSnapshot).mul(
              material.finalizadoEm
                ? new Decimal(material.medidaUtilizada || 0).plus(
                    material.medidaPerdaReal || 0,
                  )
                : new Decimal(material.medidaConsumida || 0).greaterThan(0)
                  ? new Decimal(material.medidaConsumida || 0)
                      .minus(material.medidaSobra || 0)
                      .minus(material.medidaQuebra || 0)
                  : Math.max(
                      0,
                      material.quantidadeConsumida - material.quantidadeDevolvida,
                    ),
            ),
          ),
    new Decimal(0),
  );
  const commissionCost = commissions.reduce(
    (total: Decimal, commission: any) =>
      total.plus(commission.valorConsolidado || 0),
    new Decimal(0),
  );
  const extraCost = billedOrders.reduce(
    (total: Decimal, order: any) => total.plus(order.custoExtra || 0),
    new Decimal(0),
  );
  const finalized = orders.filter((order: any) => order.producaoFinalizadaEm);
  const averageProductionDays = finalized.length
    ? finalized.reduce(
        (total: number, order: any) =>
          total +
          (order.producaoFinalizadaEm.getTime() -
            (order.producaoIniciadaEm || order.createdAt).getTime()) /
            86_400_000,
        0,
      ) / finalized.length
    : 0;
  const now = new Date();
  const overdue = orders.filter(
    (order: any) =>
      order.prazoPrevisto &&
      order.prazoPrevisto < now &&
      !["ENTREGUE", "RECUSADA", "CANCELADA"].includes(order.status),
  ).length;
  const losses = operationalMaterials.reduce(
    (total: Decimal, material: any) => total.plus(material.medidaPerdaReal || 0),
    new Decimal(0),
  );
  const consolidatedMemories = billedOrders
    .map((order: any) => order.memoriaCalculoFinanceiro as any)
    .filter(Boolean);
  const storeValue = consolidatedMemories.reduce(
    (total: Decimal, memory: any) => total.plus(memory.valorLoja || 0),
    new Decimal(0),
  );
  const goldsmithValue = consolidatedMemories.reduce(
    (total: Decimal, memory: any) => total.plus(memory.valorOurives || 0),
    new Decimal(0),
  );
  const pendingTransfers = repasses
    .filter((item: any) => item.status === "PENDENTE")
    .reduce((total: Decimal, item: any) => total.plus(item.valor), new Decimal(0));
  const paidPaymentIds = new Set(payments.map((item: any) => item.id));
  const paidTransfers = paymentItems
    .filter((item: any) => paidPaymentIds.has(item.pagamentoId))
    .reduce(
    (total: Decimal, item: any) => total.plus(item.valor),
    new Decimal(0),
  );
  const proLaboreTotal = proLabore.reduce(
    (total: Decimal, item: any) => total.plus(item.valor),
    new Decimal(0),
  );
  const lossMaterials = operationalMaterials.filter((material: any) =>
    new Decimal(material.medidaPerdaReal || 0).greaterThan(0),
  );
  const lossOrderIds = [...new Set(lossMaterials.map((material: any) => material.ordemOuriveId))];
  const [lossProducts, lossStages, transferUsers] = await Promise.all([
    prisma.produto.findMany({
      where: {
        contaId: custom.contaId,
        id: { in: [...new Set(lossMaterials.map((material: any) => material.produtoId))] },
      },
      select: { id: true, nome: true },
    }),
    db.ouriveEtapa.findMany({
      where: { ordemOuriveId: { in: lossOrderIds } },
      select: { id: true, ordemOuriveId: true },
    }),
    prisma.usuarios.findMany({
      where: {
        contaId: custom.contaId,
        id: { in: [...new Set(repasses.map((repasse: any) => repasse.usuarioId))] },
      },
      select: { id: true, nome: true },
    }),
  ]);
  const lossAssignments = await db.ouriveEtapaResponsavel.findMany({
    where: { etapaId: { in: lossStages.map((stage: any) => stage.id) } },
    select: { etapaId: true, usuarioId: true },
  });
  const lossUserIds = [...new Set(lossAssignments.map((item: any) => item.usuarioId))];
  const lossUsers = await prisma.usuarios.findMany({
    where: { contaId: custom.contaId, id: { in: lossUserIds } },
    select: { id: true, nome: true },
  });
  const pendingByGoldsmith = [...new Set(repasses.map((repasse: any) => repasse.usuarioId))]
    .map((usuarioId) => ({
      usuarioId,
      nome:
        transferUsers.find((user) => user.id === usuarioId)?.nome ||
        `Ourives #${usuarioId}`,
      valor: repasses
        .filter((repasse: any) => repasse.usuarioId === usuarioId && repasse.status === "PENDENTE")
        .reduce((total: Decimal, repasse: any) => total.plus(repasse.valor), new Decimal(0)),
    }))
    .filter((item) => new Decimal(item.valor).greaterThan(0));
  return ok(req, res, {
    totalOrdens: orders.length,
    ordensFaturadas: billedOrders.length,
    receita: revenue,
    materiais: materialCost,
    comissoes: commissionCost,
    custosExtras: extraCost,
    valorLoja: storeValue,
    valorOurives: goldsmithValue,
    repassesPendentes: pendingTransfers,
    repassesPagos: paidTransfers,
    proLabore: proLaboreTotal,
    producao: {
      finalizadas: finalized.length,
      prazoMedioDias: averageProductionDays,
      atrasadas: overdue,
    },
    perdas: {
      quantidade: losses,
      itens: lossMaterials.map((material: any) => {
        const order = orders.find((item: any) => item.id === material.ordemOuriveId);
        const stageIds = lossStages
          .filter((stage: any) => stage.ordemOuriveId === material.ordemOuriveId)
          .map((stage: any) => stage.id);
        const userIds = lossAssignments
          .filter((assignment: any) => stageIds.includes(assignment.etapaId))
          .map((assignment: any) => assignment.usuarioId);
        return {
          materialId: material.id,
          material: lossProducts.find((product) => product.id === material.produtoId)?.nome,
          ordemId: material.ordemOuriveId,
          ordem: order?.codigoRastreio,
          quantidade: material.medidaPerdaReal,
          unidade: material.unidade,
          ourives: lossUsers.filter((user) => userIds.includes(user.id)).map((user) => user.nome),
          data: material.finalizadoEm,
        };
      }),
    },
    pagamentos: {
      pendentePorOurive: pendingByGoldsmith,
      pagoPeriodo: paidTransfers,
    },
    lucroLiquido: revenue
      .minus(materialCost)
      .minus(goldsmithValue)
      .minus(extraCost)
      .minus(proLaboreTotal),
    porStatus: statusRows,
  });
}
