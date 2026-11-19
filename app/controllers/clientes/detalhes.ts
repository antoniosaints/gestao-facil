import { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { buildOperationalChargeWhere } from "../../services/financeiro/chargeVisibilityService";
import { sendClienteWhatsappMessage } from "../../services/clientes/clienteWhatsappService";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";

const sendClienteWhatsappSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("COBRANCA"),
    cobrancaId: z.coerce.number().int().positive(),
  }),
  z.object({
    tipo: z.literal("MENSAGEM"),
    mensagem: z.string().trim().min(1, "Informe a mensagem para envio."),
  }),
  z.object({
    tipo: z.literal("LANCAMENTO"),
    lancamentoId: z.coerce.number().int().positive(),
  }),
  z.object({
    tipo: z.literal("ORCAMENTO_VENDA"),
    vendaId: z.coerce.number().int().positive(),
  }),
  z.object({
    tipo: z.literal("COMPROVANTE_VENDA"),
    vendaId: z.coerce.number().int().positive(),
    telefone: z.string().trim().max(30).optional(),
  }),
]);

function getPagination(req: Request) {
  const number = (value: unknown, fallback: number) => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.max(1, Math.trunc(Number(value))) : fallback;
  const page = number(req.query.page, 1);
  const limit = Math.min(number(req.query.pageSize || req.query.limit, 10), 100);
  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

function getPeriodFilter(req: Request) {
  const inicio = req.query.inicio ? new Date(String(req.query.inicio)) : null;
  const fim = req.query.fim ? new Date(String(req.query.fim)) : null;

  if (inicio && Number.isNaN(inicio.getTime())) return {};
  if (fim && Number.isNaN(fim.getTime())) return {};

  return {
    ...(inicio ? { gte: inicio } : {}),
    ...(fim ? { lte: fim } : {}),
  };
}

function getSearch(req: Request) {
  return String(req.query.search || "").trim();
}

function withMeta<T>(items: T[], total: number, page: number, limit: number) {
  return {
    items,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    },
  };
}

function respondDetails<T>(res: Response, req: Request, items: T[], total: number, page: number, limit: number, extra: object) {
  if (req.query.pageSize !== undefined) {
    return res.json({ data: items, total, page, pageSize: limit, totalPages: Math.max(Math.ceil(total / limit), 1) });
  }
  return ResponseHandler(res, "Detalhes operacionais recuperados", { ...extra, ...withMeta(items, total, page, limit) });
}

function orderBy(req: Request, allowed: string[], fallback: string): Record<string, "asc" | "desc"> {
  const field = String(req.query.sortBy || fallback);
  return { [allowed.includes(field) ? field : fallback]: req.query.order === "asc" ? "asc" : "desc" };
}

export const getClienteOperationalDetails = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const clienteId = Number(req.params.id);
    const tab = String(req.query.tab || "cobrancas");
    const search = getSearch(req);
    const period = getPeriodFilter(req);
    const { page, limit, skip } = getPagination(req);

    const cliente = await prisma.clientesFornecedores.findFirst({
      where: {
        id: clienteId,
        contaId: customData.contaId,
      },
      select: {
        id: true,
      },
    });

    if (!cliente) {
      return ResponseHandler(res, "Cliente nao encontrado", null, 404);
    }

    const chargeClientWhere: Prisma.CobrancasFinanceirasWhereInput = {
      AND: [
        buildOperationalChargeWhere(customData.contaId),
        {
          OR: [
            { Venda: { clienteId } },
            { LancamentoParcela: { lancamento: { clienteId } } },
            { Ordemservico: { clienteId } },
          ],
        },
        ...(Object.keys(period).length ? [{ dataVencimento: period }] : []),
        ...(search
          ? [
              {
                OR: [
                  { Uid: { contains: search } },
                  { idCobranca: { contains: search } },
                  { gateway: { contains: search } },
                  { observacao: { contains: search } },
                  { Venda: { Uid: { contains: search } } },
                  { Ordemservico: { Uid: { contains: search } } },
                ],
              },
            ]
          : []),
      ],
    };

    if (tab === "cobrancas") {
      const [items, total] = await Promise.all([
        prisma.cobrancasFinanceiras.findMany({
          where: chargeClientWhere,
          orderBy: orderBy(req, ["id", "Uid", "dataVencimento", "status", "valor"], "dataVencimento"),
          take: limit,
          skip,
          include: {
            Venda: { select: { id: true, Uid: true, status: true, valor: true } },
            LancamentoParcela: {
              include: {
                lancamento: {
                  select: { id: true, Uid: true, descricao: true, tipo: true },
                },
              },
            },
            Ordemservico: { select: { id: true, Uid: true, status: true } },
          },
        }),
        prisma.cobrancasFinanceiras.count({ where: chargeClientWhere }),
      ]);

      return respondDetails(res, req, items, total, page, limit, {
        tab,
      });
    }

    if (tab === "lancamentos") {
      const where: Prisma.LancamentoFinanceiroWhereInput = {
        contaId: customData.contaId,
        clienteId,
        ...(Object.keys(period).length ? { dataLancamento: period } : {}),
        ...(search
          ? {
              OR: [
                { Uid: { contains: search } },
                { descricao: { contains: search } },
                { categoria: { nome: { contains: search } } },
                { ContasFinanceiro: { nome: { contains: search } } },
              ],
            }
          : {}),
      };

      const [items, total] = await Promise.all([
        prisma.lancamentoFinanceiro.findMany({
          where,
          orderBy: orderBy(req, ["id", "Uid", "descricao", "dataLancamento", "status", "valorTotal"], "dataLancamento"),
          take: limit,
          skip,
          include: {
            categoria: true,
            parcelas: true,
            ContasFinanceiro: true,
          },
        }),
        prisma.lancamentoFinanceiro.count({ where }),
      ]);

      return respondDetails(res, req, items, total, page, limit, {
        tab,
      });
    }

    if (tab === "vendas") {
      const where: Prisma.VendasWhereInput = {
        contaId: customData.contaId,
        clienteId,
        ...(Object.keys(period).length ? { data: period } : {}),
        ...(search
          ? {
              OR: [
                { Uid: { contains: search } },
                { observacoes: { contains: search } },
                {
                  ItensVendas: {
                    some: {
                      OR: [
                        { itemName: { contains: search } },
                        { produto: { nome: { contains: search } } },
                        { servico: { nome: { contains: search } } },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      };

      const [items, total] = await Promise.all([
        prisma.vendas.findMany({
          where,
          orderBy: orderBy(req, ["id", "Uid", "data", "status", "valor"], "data"),
          take: limit,
          skip,
          include: {
            PagamentoVendas: true,
            ItensVendas: true,
          },
        }),
        prisma.vendas.count({ where }),
      ]);

      return respondDetails(res, req, items, total, page, limit, {
        tab,
      });
    }

    if (tab === "ordens") {
      const where: Prisma.OrdensServicoWhereInput = {
        contaId: customData.contaId,
        clienteId,
        ...(Object.keys(period).length ? { data: period } : {}),
        ...(search
          ? {
              OR: [
                { Uid: { contains: search } },
                { descricao: { contains: search } },
                { descricaoCliente: { contains: search } },
              ],
            }
          : {}),
      };

      const [items, total] = await Promise.all([
        prisma.ordensServico.findMany({
          where,
          orderBy: orderBy(req, ["id", "Uid", "data", "status"], "data"),
          take: limit,
          skip,
          include: {
            ItensOrdensServico: true,
            CobrancasFinanceiras: true,
          },
        }),
        prisma.ordensServico.count({ where }),
      ]);

      return respondDetails(res, req, items, total, page, limit, {
        tab,
      });
    }

    return ResponseHandler(res, "Aba invalida para detalhes operacionais", null, 400);
  } catch (error) {
    handleError(res, error);
  }
};

export const sendClienteWhatsapp = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const clienteId = Number(req.params.id);
    const payload = {
      ...sendClienteWhatsappSchema.parse(req.body),
      instanciaId: z.coerce.number().int().positive().optional().parse(req.body.instanciaId),
    };

    const result = await sendClienteWhatsappMessage(
      customData.contaId,
      clienteId,
      payload,
    );

    return ResponseHandler(res, "Mensagem enviada com sucesso", {
      phone: result.phone,
      message: result.message,
    });
  } catch (error) {
    handleError(res, error);
  }
};
