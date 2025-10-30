import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { Prisma, StatusOrdemServico } from "../../../generated";
import { prisma } from "../../utils/prisma";

export const tableOrdensServico = async (req: Request, res: Response) => {
  const customData = getCustomRequest(req).customData;
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 10;
  const search = (req.query.search as string) || "";
  const sortBy = (req.query.sortBy as string) || "id";
  const order = req.query.order || "asc";

  const where: Prisma.OrdensServicoWhereInput = {
    contaId: customData.contaId,
  };

  if (search) {
    where.OR = [
      { descricao: { contains: search } },
      { descricaoCliente: { contains: search } },
      { Uid: { contains: search } },
      { Cliente: { nome: { contains: search } } },
      {
        ItensOrdensServico: {
          some: {
            produto: {
              OR: [
                {
                  nome: { contains: search },
                },
                {
                  codigo: { contains: search },
                },
                {
                  Uid: { contains: search },
                },
              ],
            },
            servico: {
              OR: [
                {
                  nome: { contains: search },
                },
                {
                  Uid: { contains: search },
                },
              ],
            },
          },
        },
      },
    ];
  }

  if (req.query.status) {
    where.status = req.query.status as StatusOrdemServico;
  }

  if (req.query["periodo[inicio]"] && req.query["periodo[fim]"]) {
    where.data = {
      gte: new Date(req.query["periodo[inicio]"] as string),
      lte: new Date(req.query["periodo[fim]"] as string),
    };
  }

  const total = await prisma.ordensServico.count({ where });
  const data = await prisma.ordensServico.findMany({
    where,
    orderBy: { [sortBy]: order },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: {
      Cliente: true,
      Operador: true,
      ItensOrdensServico: true
    },
  });

  res.json({
    data,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
};

export const ListagemMobileOrdens = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const {
    search = undefined,
    limit = "10",
    page = "1",
  } = req.query as { search: string; limit: string; page: string };

  try {
    const model = prisma.ordensServico;

    const where: Prisma.OrdensServicoWhereInput = {
      contaId: customData.contaId,
    };
    if (search) {
      where.OR = [
        { descricao: { contains: search } },
        { descricaoCliente: { contains: search } },
        { Uid: { contains: search } },
        { Cliente: { nome: { contains: search } } },
        {
          ItensOrdensServico: {
            some: {
              produto: {
                OR: [
                  {
                    nome: { contains: search },
                  },
                  {
                    codigo: { contains: search },
                  },
                  {
                    Uid: { contains: search },
                  },
                ],
              },
              servico: {
                OR: [
                  {
                    nome: { contains: search },
                  },
                  {
                    Uid: { contains: search },
                  },
                ],
              },
            },
          },
        },
      ];
    }

    const take = Number(limit);
    const skip = (Number(page) - 1) * take;

    const [data, total] = await Promise.all([
      model.findMany({
        where,
        skip,
        take,
        orderBy: { data: "asc" },
        include: {
            ItensOrdensServico: true,
            Cliente: true
        }
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
