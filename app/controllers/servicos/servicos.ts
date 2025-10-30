import { Request, Response } from "express";
import { handleError } from "../../utils/handleError";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { ResponseHandler } from "../../utils/response";
import { Prisma } from "../../../generated";

export const saveServico = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    if (!req.body) {
      return ResponseHandler(res, "Dados obrigatorio!", null, 400);
    }
    if (!req.body.nome || !req.body.preco) {
      return ResponseHandler(
        res,
        "Nome do servico e preco obrigatorio!",
        null,
        400
      );
    }

    if (req.body.id) {
      await prisma.servicos.update({
        where: {
          id: Number(req.body.id),
          contaId: customData.contaId,
        },
        data: {
          nome: req.body.nome,
          preco: req.body.preco,
          status: req.body.status,
          descricao: req.body.descricao,
        },
      });
      return ResponseHandler(res, "Servico atualizado com sucesso", null, 200);
    }

    await prisma.servicos.create({
      data: {
        nome: req.body.nome,
        preco: req.body.preco,
        contaId: customData.contaId,
        status: req.body.status,
        descricao: req.body.descricao,
        Uid: gerarIdUnicoComMetaFinal("SRV"),
      },
    });

    return ResponseHandler(res, "Servico cadastrado com sucesso", null, 200);
  } catch (err: any) {
    handleError(res, err);
  }
};
export const getServico = async (req: Request, res: Response): Promise<any> => {
  try {
    if (!req.params.id || isNaN(Number(req.params.id))) {
      return ResponseHandler(res, "Id nao encontrado", null, 404);
    }
    const customData = getCustomRequest(req).customData;
    const servico = await prisma.servicos.findFirst({
      where: {
        id: Number(req.params.id),
        contaId: customData.contaId,
      },
    });
    if (!servico) {
      return ResponseHandler(res, "Servico nao encontrado", null, 404);
    }
    return ResponseHandler(res, "Servico encontrado", servico);
  } catch (err: any) {
    handleError(res, err);
  }
};
export const getServicos = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const servicos = await prisma.servicos.findMany({
      where: {
        contaId: customData.contaId,
      },
    });
    return ResponseHandler(res, "Servicos encontrados", servicos);
  } catch (err: any) {
    handleError(res, err);
  }
};
export const deleteServico = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { id } = req.params;
    const customData = getCustomRequest(req).customData;
    const servico = await prisma.servicos.delete({
      where: {
        id: Number(id),
        contaId: customData.contaId,
      },
    });
    return ResponseHandler(res, "Servico deletado", servico);
  } catch (err: any) {
    handleError(res, err);
  }
};
export const tableServico = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 10;
  const search = (req.query.search as string) || "";
  const sortBy = (req.query.sortBy as string) || "id";
  const order = req.query.order || "asc";

  const where: Prisma.ServicosWhereInput = {
    contaId: customData.contaId,
  };
  if (search) {
    where.OR = [
      { nome: { contains: search } },
      { Uid: { contains: search } },
      { descricao: { contains: search } },
    ];
  }

  if (req.query.status) {
    where.status = req.query.status as any;
  }

  const total = await prisma.servicos.count({ where });
  const data = await prisma.servicos.findMany({
    where,
    orderBy: { [sortBy]: order },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  res.json({
    data,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
};
export const mobileServico = async (
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
    const model = prisma.servicos;

    const where: Prisma.ServicosWhereInput = { contaId: customData.contaId };
    if (search) {
      where.OR = [
        { Uid: { contains: search } },
        { nome: { contains: search } },
        { descricao: { contains: search } },
      ];
    }

    const take = Number(limit);
    const skip = (Number(page) - 1) * take;

    const [data, total] = await Promise.all([
      model.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "asc" },
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
