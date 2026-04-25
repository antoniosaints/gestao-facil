import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { Prisma, StatusVenda } from "../../../generated";

export const ListagemMobileVendas = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const {
    status = null,
    search = undefined,
    limit = "10",
    page = "1",
  } = req.query as { search: string; limit: string; page: string, status: StatusVenda | null };

  try {
    const model = prisma.vendas;

    const where: Prisma.VendasWhereInput = { contaId: customData.contaId };

    const advancedFilters: Prisma.VendasWhereInput[] = [];

    if (status) {
      if (status === 'FATURADO') {
        where.faturado = true
      }
      if (status === 'PENDENTE') {
        where.faturado = false
        where.status = undefined
      }
    }

    if (search) {
      where.OR = [
        { Uid: { contains: search } },
        { observacoes: { contains: search } },
        { cliente: { nome: { contains: search } } },
        { vendedor: { nome: { contains: search } } },
      ];
    }

    const clienteId = Number(req.query.clienteId);
    if (Number.isInteger(clienteId) && clienteId > 0) {
      where.clienteId = clienteId;
    }

    const vendedorId = Number(req.query.vendedorId);
    if (Number.isInteger(vendedorId) && vendedorId > 0) {
      where.vendedorId = vendedorId;
    }

    const produtoId = Number(req.query.produtoId);
    if (Number.isInteger(produtoId) && produtoId > 0) {
      advancedFilters.push({
        ItensVendas: {
          some: {
            produtoId,
          },
        },
      });
    }

    const servicoId = Number(req.query.servicoId);
    if (Number.isInteger(servicoId) && servicoId > 0) {
      advancedFilters.push({
        ItensVendas: {
          some: {
            servicoId,
          },
        },
      });
    }

    if (req.query.desconto === "COM_DESCONTO") {
      advancedFilters.push({
        desconto: { gt: 0 } as any,
      });
    }

    if (req.query.desconto === "SEM_DESCONTO") {
      advancedFilters.push({
        OR: [{ desconto: { equals: 0 } as any }, { desconto: null }],
      });
    }

    const periodoInicio = (req.query["periodo[inicio]"] || req.query.inicio) as string | undefined;
    const periodoFim = (req.query["periodo[fim]"] || req.query.fim) as string | undefined;

    if (periodoInicio && periodoFim) {
      where.data = {
        gte: new Date(periodoInicio),
        lte: new Date(periodoFim),
      };
    }

    if (advancedFilters.length) {
      where.AND = [...(where.AND || []), ...advancedFilters];
    }

    const take = Number(limit);
    const skip = (Number(page) - 1) * take;

    const [data, total] = await Promise.all([
      model.findMany({
        include: { cliente: true, vendedor: true },
        where,
        skip,
        take,
        orderBy: { data: "asc" },
      }),
      model.count({ where }),
    ]);

    const totalPages = Math.ceil(total / take);

    res.json({
      data,
      pagination: {
        total,
        page: Number(page),
        limit: take,
        totalPages,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message || "Erro ao buscar os dados" });
  }
};
