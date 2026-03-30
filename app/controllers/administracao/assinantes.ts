import { Request, Response } from "express";
import { differenceInCalendarDays, startOfDay } from "date-fns";
import { Prisma } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { clearCacheAccount } from "./contas";

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

    const status = String(req.body?.status || "").toUpperCase();
    const vencimentoRaw = req.body?.vencimento;

    if (!ensureValidStatus(status)) {
      return res.status(400).json({
        message: "Status inválido para a conta.",
      });
    }

    const updateData: Prisma.ContasUpdateInput = {
      status: status as any,
    };

    if (vencimentoRaw) {
      const vencimento = new Date(vencimentoRaw);
      if (Number.isNaN(vencimento.getTime())) {
        return res.status(400).json({
          message: "Data de vencimento inválida.",
        });
      }

      updateData.vencimento = vencimento;
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
      },
    });

    await clearCacheAccount(contaId);

    return res.status(200).json({
      message: "Conta atualizada com sucesso.",
      data: conta,
    });
  } catch (error) {
    return handleError(res, error);
  }
};
