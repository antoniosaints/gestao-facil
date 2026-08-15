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

const rolesSchema = z.object({
  papeis: z
    .array(z.enum(["GESTOR", "ATENDIMENTO", "OURIVE", "REVISAO"]))
    .max(4),
  especialidadeIds: z.array(z.number().int().positive()).default([]),
});
const orderSchema = z.object({
  clienteId: z.number().int().positive(),
  descricao: z.string().min(3),
  garantia: z.string().default("Sem garantia informada"),
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
        quantidade: z.coerce.number().int().positive(),
        custoUnitario: z.coerce.number().nonnegative().default(0),
        valorUnitario: z.coerce.number().nonnegative().default(0),
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
      prazoAprovacaoDias: z.number().int().min(1).max(30).optional(),
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
  const categoryIds = [
    parsed.data.receitaCategoriaId,
    parsed.data.comissaoCategoriaId,
  ].filter((value): value is number => Boolean(value));
  const accountIds = [
    parsed.data.receitaContaFinanceiraId,
    parsed.data.comissaoContaFinanceiraId,
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
      create: { contaId, ...parsed.data },
      update: parsed.data,
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
  const client = await prisma.clientesFornecedores.findFirst({
    where: { id: parsed.data.clienteId, contaId: custom.contaId },
  });
  if (!client)
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
        clienteId: client.id,
        operadorId: custom.userId,
        status: "ABERTA",
      },
    });
    const ourive = await (tx as any).ouriveOrdem.create({
      data: {
        contaId: custom.contaId,
        ordemServicoId: base.id,
        codigoRastreio: `OUR-${base.id}-${randomBytes(3).toString("hex").toUpperCase()}`,
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
      "Peça(s) recebida(s) sob custodia.",
      custom.userId,
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
  const products = await prisma.produto.findMany({
    where: {
      contaId: custom.contaId,
      id: { in: parsed.data.materiais.map((item) => item.produtoId) },
    },
    select: {
      id: true,
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
  // Mesmo quando a tela ainda enviar o valor zerado (OS antigas ou cache do navegador),
  // o material da empresa deve compor a proposta com o preço cadastrado da variante.
  const materials = parsed.data.materiais.map((material) => {
    const product = productById.get(material.produtoId)!;
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
        : total.plus(money(material.valorUnitario).mul(material.quantidade)),
    new Decimal(0),
  );
  const materialCost = materials.reduce(
    (total, material) =>
      material.fornecidoPeloCliente
        ? total
        : total.plus(money(material.custoUnitario).mul(material.quantidade)),
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
    await (tx as any).ouriveMaterial.deleteMany({
      where: { ordemOuriveId: order.id, quantidadeConsumida: 0 },
    });
    if (materials.length)
      await (tx as any).ouriveMaterial.createMany({
        data: materials.map(({
          produtoId,
          pecaId,
          quantidade,
          custoUnitario,
          valorUnitario,
          fornecidoPeloCliente,
        }) => ({
          ordemOuriveId: order.id,
          produtoId,
          pecaId,
          fornecidoPeloCliente,
          quantidadePlanejada: quantidade,
          custoSnapshot: money(custoUnitario),
          valorUnitario: money(valorUnitario),
        })),
      });
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
    await (tx as any).ouriveOrdem.update({
      where: { id: order.id },
      data: { status: accepted ? "ORCAMENTO" : "RECUSADA" },
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
      { origem: origin, versao: budget.versao, observacao: observation },
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
    quantidade: number;
    fornecidoPeloCliente: boolean;
    valorUnitario: Decimal.Value;
    descricao: string;
  }> = (materials || []).map((material: any) => ({
    quantidade: material.quantidadePlanejada,
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
    await db.ouriveOrdem.update({
      where: { id: order.id },
      data: { status: "REVISAO" },
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
  if (order.status !== "ORCAMENTO")
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
        data: { status: "PRODUCAO" },
      });
      await tx.ordensServico.update({
        where: { id: order.ordemServicoId },
        data: { status: "ANDAMENTO" },
      });
      await event(
        tx,
        order.id,
        "MATERIAL",
        "Producao iniciada e materiais consumidos.",
        custom.userId,
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
  if (order.status !== "REVISAO")
    return fail(
      req,
      res,
      409,
      "review_required",
      "A revisao aprovada e obrigatoria antes da entrega.",
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
      fornecidoPeloCliente: true,
      valorUnitario: true,
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
  const result = await prisma.$transaction(async (tx) => {
    const reserved = await (tx as any).ouriveOrdem.updateMany({
      where: { id: order.id, faturadaEm: null },
      data: {
        faturadaEm: new Date(),
        entregueEm: new Date(),
        status: "ENTREGUE",
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
      { receitaLancamentoId: revenue.id },
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
    },
  });
  const orderIds = orders.map((item: any) => item.id);
  const [budgets, stages, commissions] = await Promise.all([
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
    "PRODUCAO",
    "REVISAO",
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
  const dateRange =
    req.query.inicio || req.query.fim
      ? {
          ...(req.query.inicio ? { gte: new Date(String(req.query.inicio)) } : {}),
          ...(req.query.fim ? { lte: new Date(String(req.query.fim)) } : {}),
        }
      : undefined;
  // As quantidades por status representam recebimentos do período. Já receita
  // e custos consideram exclusivamente OS faturadas no período, evitando que
  // um orçamento aprovado infle o resultado antes da entrega.
  const [orders, billedOrders, statusRows] = await Promise.all([
    db.ouriveOrdem.findMany({
      where: { contaId: custom.contaId, ...(dateRange ? { createdAt: dateRange } : {}) },
    }),
    db.ouriveOrdem.findMany({
      where: {
        contaId: custom.contaId,
        faturadaEm: dateRange ? dateRange : { not: null },
      },
    }),
    db.ouriveOrdem.groupBy({
      by: ["status"],
      where: { contaId: custom.contaId, ...(dateRange ? { createdAt: dateRange } : {}) },
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
  const commissions = await db.ouriveComissao.findMany({
    where: {
      ordemOuriveId: { in: billedIds },
      consolidadaEm: { not: null },
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
              Math.max(
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
  return ok(req, res, {
    totalOrdens: orders.length,
    ordensFaturadas: billedOrders.length,
    receita: revenue,
    materiais: materialCost,
    comissoes: commissionCost,
    custosExtras: extraCost,
    lucroLiquido: revenue
      .minus(materialCost)
      .minus(commissionCost)
      .minus(extraCost),
    porStatus: statusRows,
  });
}
