import { Request, Response } from "express";
import { addDays, differenceInCalendarDays, isAfter, startOfDay } from "date-fns";
import Decimal from "decimal.js";
import { z } from "zod";
import { deleteContaCompletely } from "../../services/administracao/deleteContaService";
import { hashPassword } from "../../services/auth/passwordService";
import { getOrCreateCodigoIndicacao } from "../../services/contas/indicacaoService";
import { getConfiguredPlatformGateway } from "../../services/contas/platformGatewayService";
import { Prisma } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { clearCacheAccount } from "./contas";
import {
  cancelOutstandingModuleCharges,
  ensureDefaultStoreModules,
  getContaNextRecurringValue,
  syncContaRecurringBilling,
  type ModuleStatus,
} from "../../services/contas/storeModulesService";

const ALLOWED_SORT_FIELDS = new Set([
  "id",
  "nome",
  "nomeFantasia",
  "email",
  "status",
  "vencimento",
  "valor",
  "data",
  "funcionarios",
  "gateway",
]);

export async function assertSuperAdmin(userId: number) {
  const usuario = await prisma.usuarios.findUniqueOrThrow({
    where: {
      id: userId,
    },
    select: {
      id: true,
      superAdmin: true,
    },
  });

  return usuario.superAdmin;
}

function ensureValidStatus(status: string) {
  return ["ATIVO", "INATIVO", "BLOQUEADO"].includes(status);
}

function getAdminModuleState(moduleLink?: {
  status: ModuleStatus;
  vencimento: Date;
  cobrancaAtualId?: number | null;
}) {
  const now = new Date();

  if (!moduleLink) {
    return {
      ativo: false,
      pendenteAtivacao: false,
      cancelamentoAgendado: false,
      cobrancaPendenteAtual: false,
    };
  }

  const stillAvailable =
    moduleLink.status === "ATIVO" ||
    (moduleLink.status === "CANCELAMENTO_AGENDADO" && isAfter(moduleLink.vencimento, now));

  return {
    ativo: stillAvailable,
    pendenteAtivacao: moduleLink.status === "PENDENTE_ATIVACAO",
    cancelamentoAgendado: moduleLink.status === "CANCELAMENTO_AGENDADO",
    cobrancaPendenteAtual:
      moduleLink.status === "PENDENTE_ATIVACAO" && !!moduleLink.cobrancaAtualId,
  };
}

async function ensureAdminAccess(req: Request, res: Response) {
  const customData = getCustomRequest(req).customData;
  const isSuperAdmin = await assertSuperAdmin(customData.userId);

  if (!isSuperAdmin) {
    res.status(403).json({
      message: "Usuário não tem permissão para gerenciar essas contas.",
    });
    return null;
  }

  return customData;
}

const createAssinanteAdminSchema = z.object({
  conta: z.string().trim().min(2, "Informe o nome da conta."),
  nomeUsuario: z.string().trim().min(2, "Informe o nome do usuário root."),
  email: z.string().trim().email("Informe um e-mail válido."),
  senha: z.string().min(6, "A senha precisa de ao menos 6 caracteres."),
  telefone: z.string().trim().min(8, "Informe um telefone válido."),
  tipo: z.string().trim().min(2).default("EMPRESA"),
  funcionarios: z.coerce.number().int().positive().default(1),
  valorBasePlano: z.coerce.number().positive().default(70),
  diasTeste: z.coerce.number().int().min(0).max(365).default(7),
});

export const createAssinanteAdmin = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await ensureAdminAccess(req, res);
    if (!customData) return;

    const parsed = createAssinanteAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0].message,
      });
    }

    const data = parsed.data;

    const emailExists = await prisma.usuarios.findFirst({
      where: {
        email: data.email,
      },
      select: {
        id: true,
      },
    });

    if (emailExists) {
      return res.status(400).json({
        message: "Já existe um usuário com esse e-mail.",
      });
    }

    const platformGateway = await getConfiguredPlatformGateway();

    const resultado = await prisma.$transaction(async (tx) => {
      const conta = await tx.contas.create({
        data: {
          nome: data.conta,
          email: data.email,
          valor: data.valorBasePlano,
          valorBasePlano: data.valorBasePlano,
          asaasCustomerId: "MERCADOPAGO",
          data: new Date(),
          funcionarios: data.funcionarios,
          gateway: platformGateway as any,
          vencimento: addDays(new Date(), data.diasTeste),
          categoria: data.tipo,
          tipo: data.tipo,
          status: "ATIVO",
          telefone: data.telefone,
        },
      });

      const usuario = await tx.usuarios.create({
        data: {
          nome: data.nomeUsuario,
          email: data.email,
          senha: await hashPassword(data.senha),
          emailReceiver: true,
          pushReceiver: true,
          permissao: "root",
          status: "ATIVO",
          contaId: conta.id,
          telefone: data.telefone,
        },
      });

      return { conta, usuario };
    });

    await getOrCreateCodigoIndicacao(resultado.conta.id).catch((e) =>
      console.error("[indicacao] falha ao gerar código:", e),
    );

    console.log(
      `[admin] Conta ${resultado.conta.id} (${resultado.conta.nome}) criada pelo superadmin ${customData.userId}`,
    );

    return res.status(201).json({
      message: "Assinante criado com sucesso",
      data: {
        contaId: resultado.conta.id,
        usuarioId: resultado.usuario.id,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const deleteAssinanteAdmin = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await ensureAdminAccess(req, res);
    if (!customData) return;

    const contaId = Number(req.params.id);
    if (!contaId) {
      return res.status(400).json({ message: "Informe a conta a ser removida." });
    }

    if (contaId === customData.contaId) {
      return res.status(400).json({
        message: "Não é possível apagar a própria conta do superadmin.",
      });
    }

    const conta = await prisma.contas.findUnique({
      where: {
        id: contaId,
      },
      select: {
        id: true,
        nome: true,
      },
    });

    if (!conta) {
      return res.status(404).json({ message: "Conta não encontrada." });
    }

    await deleteContaCompletely(contaId);
    await clearCacheAccount(contaId);

    console.warn(
      `[admin] Conta ${contaId} (${conta.nome}) APAGADA pelo superadmin ${customData.userId}`,
    );

    return res.json({
      message: `Assinante ${conta.nome} apagado com todos os dados vinculados.`,
    });
  } catch (error) {
    handleError(res, error);
  }
};

const resetRootPasswordSchema = z.object({
  senha: z.string().min(6, "A nova senha precisa de ao menos 6 caracteres."),
});

export const resetRootPasswordAdmin = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await ensureAdminAccess(req, res);
    if (!customData) return;

    const contaId = Number(req.params.id);
    if (!contaId) {
      return res.status(400).json({ message: "Conta inválida." });
    }

    const parsed = resetRootPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    const conta = await prisma.contas.findUnique({
      where: { id: contaId },
      select: { id: true, nome: true },
    });

    if (!conta) {
      return res.status(404).json({ message: "Conta não encontrada." });
    }

    const rootUsers = await prisma.usuarios.findMany({
      where: {
        contaId,
        permissao: "root",
      },
      select: {
        id: true,
        nome: true,
        email: true,
      },
      orderBy: {
        id: "asc",
      },
    });

    if (!rootUsers.length) {
      return res.status(404).json({
        message: "Esta conta não possui um usuário root para recuperar.",
      });
    }

    await prisma.usuarios.updateMany({
      where: {
        contaId,
        permissao: "root",
      },
      data: {
        senha: await hashPassword(parsed.data.senha),
      },
    });

    await clearCacheAccount(contaId);

    console.warn(
      `[admin] Senha do root da conta ${contaId} (${conta.nome}) redefinida pelo superadmin ${customData.userId}`,
    );

    const principal = rootUsers[0];

    return res.status(200).json({
      message: `Senha do usuário root de ${conta.nome} redefinida com sucesso.`,
      data: {
        contaId,
        email: principal.email,
        nome: principal.nome,
        totalUsuariosRoot: rootUsers.length,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const tableAssinantesAdmin = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const isSuperAdmin = await assertSuperAdmin(customData.userId);

    if (!isSuperAdmin) {
      return res.status(403).json({
        message: "Usuário não tem permissão para visualizar esses dados.",
      });
    }

    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const pageSize = Number(req.query.pageSize) > 0 ? Number(req.query.pageSize) : 10;
    const search = String(req.query.search || "").trim();
    const requestedSortBy = String(req.query.sortBy || "id");
    const sortBy = ALLOWED_SORT_FIELDS.has(requestedSortBy) ? requestedSortBy : "id";
    const order: Prisma.SortOrder = req.query.order === "desc" ? "desc" : "asc";
    const statusFilter = String(req.query.status || "TODOS").toUpperCase();

    const where: Prisma.ContasWhereInput = {};

    if (statusFilter !== "TODOS" && ["ATIVO", "INATIVO", "BLOQUEADO"].includes(statusFilter)) {
      where.status = statusFilter as any;
    }

    if (search) {
      where.OR = [
        { nome: { contains: search } },
        { nomeFantasia: { contains: search } },
        { email: { contains: search } },
        { telefone: { contains: search } },
        { documento: { contains: search } },
      ];
    }

    const [total, contas] = await Promise.all([
      prisma.contas.count({ where }),
      prisma.contas.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: {
          [sortBy]: order,
        },
        select: {
          id: true,
          nome: true,
          nomeFantasia: true,
          email: true,
          telefone: true,
          documento: true,
          status: true,
          vencimento: true,
          valor: true,
          valorBasePlano: true,
          creditoIndicacao: true,
          codigoIndicacao: true,
          indicadoPorContaId: true,
          data: true,
          funcionarios: true,
          gateway: true,
          tipo: true,
          createdAt: true,
          _count: {
            select: {
              Usuarios: true,
            },
          },
          FaturasContas: {
            where: {
              status: "PENDENTE",
            },
            select: {
              urlPagamento: true,
              vencimento: true,
            },
            orderBy: {
              vencimento: "asc",
            },
            take: 1,
          },
        },
      }),
    ]);

    const today = startOfDay(new Date());
    const data = contas.map((conta) => {
      const dueDate = startOfDay(conta.vencimento);
      const diasParaVencer = differenceInCalendarDays(dueDate, today);

      return {
        id: conta.id,
        Uid: `#${conta.id}`,
        nome: conta.nome,
        nomeFantasia: conta.nomeFantasia,
        email: conta.email,
        telefone: conta.telefone,
        documento: conta.documento,
        status: conta.status,
        vencimento: conta.vencimento,
        valor: Number(conta.valor || 0),
        valorBasePlano: Number(conta.valorBasePlano || 0),
        creditoIndicacao: Number(conta.creditoIndicacao || 0),
        codigoIndicacao: conta.codigoIndicacao,
        indicadoPorContaId: conta.indicadoPorContaId,
        data: conta.data,
        funcionarios: conta.funcionarios,
        gateway: conta.gateway,
        tipo: conta.tipo,
        createdAt: conta.createdAt,
        usuariosTotal: conta._count.Usuarios,
        diasParaVencer,
        statusAssinatura: diasParaVencer < 0 ? "VENCIDA" : diasParaVencer === 0 ? "VENCE_HOJE" : "EM_DIA",
        linkPagamentoPendente: conta.FaturasContas[0]?.urlPagamento || null,
      };
    });

    return res.json({
      data,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const manageAssinanteSchema = z.object({
  status: z.string().optional(),
  vencimento: z.union([z.string(), z.date()]).optional(),
  nome: z.string().trim().min(2, "Informe o nome da conta.").optional(),
  nomeFantasia: z.string().trim().optional().nullable(),
  email: z.string().trim().email("Informe um e-mail válido.").optional(),
  telefone: z.string().trim().optional().nullable(),
  documento: z.string().trim().optional().nullable(),
  valorBasePlano: z.coerce.number().min(0, "Mensalidade inválida.").optional(),
});

export const manageAssinanteAdmin = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const isSuperAdmin = await assertSuperAdmin(customData.userId);

    if (!isSuperAdmin) {
      return res.status(403).json({
        message: "Usuário não tem permissão para gerenciar essas contas.",
      });
    }

    const contaId = Number(req.params.id);

    if (!contaId) {
      return res.status(400).json({
        message: "Conta inválida.",
      });
    }

    const parsed = manageAssinanteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const body = parsed.data;

    const status = String(body.status || "").toUpperCase();
    if (!ensureValidStatus(status)) {
      return res.status(400).json({
        message: "Status inválido para a conta.",
      });
    }

    const contaAtual = await prisma.contas.findUnique({
      where: { id: contaId },
      select: { id: true, valorBasePlano: true },
    });
    if (!contaAtual) {
      return res.status(404).json({ message: "Conta não encontrada." });
    }

    const updateData: Prisma.ContasUpdateInput = {
      status: status as any,
    };

    if (body.vencimento) {
      const vencimento = new Date(body.vencimento);
      if (Number.isNaN(vencimento.getTime())) {
        return res.status(400).json({
          message: "Data de vencimento inválida.",
        });
      }
      updateData.vencimento = vencimento;
    }

    // Campos editáveis do assinante (apenas quando enviados)
    if (body.nome !== undefined) updateData.nome = body.nome;
    if (body.nomeFantasia !== undefined) updateData.nomeFantasia = body.nomeFantasia || null;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.telefone !== undefined) updateData.telefone = body.telefone || null;
    if (body.documento !== undefined) updateData.documento = body.documento || null;

    const valorBaseMudou =
      body.valorBasePlano !== undefined &&
      !new Decimal(body.valorBasePlano).equals(new Decimal(contaAtual.valorBasePlano ?? 0));
    if (body.valorBasePlano !== undefined) {
      updateData.valorBasePlano = new Decimal(body.valorBasePlano).toFixed(2);
    }

    const conta = await prisma.contas.update({
      where: {
        id: contaId,
      },
      data: updateData,
      select: {
        id: true,
        nome: true,
        status: true,
        vencimento: true,
        valorBasePlano: true,
        valor: true,
      },
    });

    // Mudou a mensalidade base: recomputa valor (base + apps) e sincroniza gateway/faturas.
    if (valorBaseMudou) {
      await syncContaRecurringBilling(contaId);
    }

    await clearCacheAccount(contaId);

    return res.status(200).json({
      message: "Conta atualizada com sucesso.",
      data: conta,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listAssinanteAppsAdmin = async (req: Request, res: Response): Promise<any> => {
  try {
    if (!(await ensureAdminAccess(req, res))) return

    const contaId = Number(req.params.id);
    if (!contaId) {
      return res.status(400).json({ message: "Conta inválida." });
    }

    await ensureDefaultStoreModules();

    const [conta, modulos] = await Promise.all([
      prisma.contas.findUniqueOrThrow({
        where: { id: contaId },
        select: {
          id: true,
          nome: true,
          status: true,
          vencimento: true,
          valor: true,
          valorBasePlano: true,
        },
      }),
      prisma.modulosAdicionais.findMany({
        where: { status: true },
        orderBy: { createdAt: "asc" },
        include: {
          moduloOnContas: {
            where: { contaId },
            take: 1,
            orderBy: { updatedAt: "desc" },
            include: {
              CobrancaAtual: {
                select: {
                  id: true,
                  status: true,
                  gateway: true,
                  externalLink: true,
                  dataVencimento: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const data = modulos.map((modulo) => {
      const vinculo = modulo.moduloOnContas[0];
      const state = getAdminModuleState(
        vinculo
          ? {
              status: vinculo.status as ModuleStatus,
              vencimento: vinculo.vencimento,
              cobrancaAtualId: vinculo.cobrancaAtualId,
            }
          : undefined,
      );

      return {
        id: modulo.id,
        codigo: modulo.codigo,
        nome: modulo.nome,
        descricao: modulo.descricao,
        categoria: modulo.categoria,
        preco: Number(vinculo?.valorAdicional ?? modulo.preco ?? 0),
        ativo: state.ativo,
        pendenteAtivacao: state.pendenteAtivacao,
        cancelamentoAgendado: state.cancelamentoAgendado,
        cobrancaPendenteAtual: state.cobrancaPendenteAtual,
        vigenciaAte: vinculo?.vencimento ?? null,
        statusVinculo: vinculo?.status ?? null,
        cobrancaAtual: vinculo?.CobrancaAtual
          ? {
              id: vinculo.CobrancaAtual.id,
              status: vinculo.CobrancaAtual.status,
              gateway: vinculo.CobrancaAtual.gateway,
              linkPagamento: vinculo.CobrancaAtual.externalLink,
              vencimento: vinculo.CobrancaAtual.dataVencimento,
            }
          : null,
      };
    });

    return res.json({
      data,
      resumo: {
        contaId: conta.id,
        contaNome: conta.nome,
        contaStatus: conta.status,
        mensalidadeAtual: Number(conta.valor ?? 0),
        valorBasePlano: Number(conta.valorBasePlano ?? 0),
        totalAppsAtivos: data.filter((item) => item.ativo).length,
        totalAppsPendentes: data.filter((item) => item.pendenteAtivacao).length,
        vencimento: conta.vencimento,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const toggleAssinanteAppAdmin = async (req: Request, res: Response): Promise<any> => {
  try {
    if (!(await ensureAdminAccess(req, res))) return

    const contaId = Number(req.params.id);
    const moduleId = Number(req.params.moduleId);
    const ativo = Boolean(req.body?.ativo);

    if (!contaId || !moduleId) {
      return res.status(400).json({ message: "Conta ou app inválido." });
    }

    await ensureDefaultStoreModules();

    const [conta, modulo, vinculoAtual] = await Promise.all([
      prisma.contas.findUniqueOrThrow({
        where: { id: contaId },
        select: {
          id: true,
          nome: true,
          vencimento: true,
        },
      }),
      prisma.modulosAdicionais.findFirstOrThrow({
        where: {
          id: moduleId,
          status: true,
        },
      }),
      prisma.moduloOnConta.findUnique({
        where: {
          moduloId_contaId: {
            moduloId: moduleId,
            contaId,
          },
        },
      }),
    ]);

    if (ativo) {
      if (vinculoAtual) {
        await cancelOutstandingModuleCharges([vinculoAtual.id], true);

        await prisma.moduloOnConta.update({
          where: { id: vinculoAtual.id },
          data: {
            valorAdicional: modulo.preco,
            status: "ATIVO",
            ativoDesde: new Date(),
            solicitadoCancelamentoEm: null,
            canceladoEm: null,
            vencimento: conta.vencimento,
            cobrancaAtualId: null,
            tipoCobrancaAtual: null,
            valorCobrancaAtual: null,
          },
        });
      } else {
        await prisma.moduloOnConta.create({
          data: {
            contaId,
            moduloId: modulo.id,
            valorAdicional: modulo.preco,
            status: "ATIVO",
            ativoDesde: new Date(),
            vencimento: conta.vencimento,
          },
        });
      }
    } else {
      if (!vinculoAtual) {
        return res.status(404).json({ message: "Este app não está vinculado à conta." });
      }

      await cancelOutstandingModuleCharges([vinculoAtual.id], true);
      await prisma.moduloOnConta.update({
        where: { id: vinculoAtual.id },
        data: {
          status: "CANCELADO",
          canceladoEm: new Date(),
          solicitadoCancelamentoEm: null,
          cobrancaAtualId: null,
          tipoCobrancaAtual: null,
          valorCobrancaAtual: null,
        },
      });
    }

    const recurringValue = await syncContaRecurringBilling(contaId);

    return res.json({
      message: ativo
        ? `App ${modulo.nome} ativado manualmente para a conta ${conta.nome}.`
        : `App ${modulo.nome} desativado manualmente para a conta ${conta.nome}.`,
      data: {
        recurringValue: recurringValue.toNumber(),
        contaId,
        moduleId,
        ativo,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};
