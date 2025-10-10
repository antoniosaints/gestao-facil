import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { Prisma } from "../../../generated";
import { isAccountOverdue } from "../../routers/web";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";
import { hasPermission } from "../../helpers/userPermission";

export const getMinhaConexao = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const usuario = await prisma.usuarios.findUniqueOrThrow({
      where: {
        id: customData.userId,
        contaId: customData.contaId,
      },
    });
    return res.json({ status: "success", data: usuario });
  } catch (error) {
    return handleError(res, error);
  }
}
export const tableUsuarios = async (req: Request, res: Response): Promise<any> => {
  const customData = getCustomRequest(req).customData;

  if (await isAccountOverdue(req))
    return res.status(404).json({
      message: "Conta inativa ou bloqueada, verifique seu plano",
    });

  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 10;
  const search = (req.query.search as string) || "";
  const sortBy = (req.query.sortBy as string) || "id";
  const order = req.query.order || "asc";

  const where: Prisma.UsuariosWhereInput = {
    contaId: customData.contaId,
  };
  if (search) {
    where.OR = [{ nome: { contains: search } }];
  }

  const total = await prisma.usuarios.count({ where });
  const data = await prisma.usuarios.findMany({
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


export const toggleModeGerencial = async (req: Request, res: Response): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const usuario = await prisma.usuarios.findUniqueOrThrow({
    where: {
      id: customData.userId,
      contaId: customData.contaId,
    },
  });

  if (usuario.superAdmin) {
    await prisma.usuarios.update({
      where: {
        id: customData.userId,
        contaId: customData.contaId,
      },
      data: {
        gerencialMode: !usuario.gerencialMode,
      },
    });
    return res.json({ status: "success" });
  } else {
    return res
      .status(403)
      .json({
        message: "Usuário não tem permissão para alterar o modo gerencial",
      });
  }
};

export const deleteUsuario = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  if (await isAccountOverdue(req))
    return ResponseHandler(res, "Conta inativa ou bloqueada!", null, 404);

  if (!(await hasPermission(customData, 4))) {
    return ResponseHandler(res, "Nível de permissão insuficiente!", null, 403);
  }

  try {
    const userRoot = await prisma.usuarios.findFirst({
      where: {
        id: Number(req.params.id),
        contaId: customData.contaId,
      },
    });

    if (userRoot?.permissao === "root") {
      return ResponseHandler(
        res,
        "Usuário root nao pode ser deletado!",
        null,
        400
      );
    }
    await prisma.usuarios.delete({
      where: {
        id: Number(req.params.id),
        contaId: customData.contaId,
      },
    });
    return ResponseHandler(res, "Usuário deletado com sucesso!");
  } catch (error) {
    handleError(res, error);
  }
};

export const listagemMobileUsuarios = async (
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
    const model = prisma.usuarios;

    const where: Prisma.UsuariosWhereInput = { contaId: customData.contaId };
    if (search) {
      where.OR = [
        { nome: { contains: search } },
        { email: { contains: search } },
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

export const saveUsuario = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  if (await isAccountOverdue(req))
    return ResponseHandler(res, "Conta inativa ou bloqueada!", null, 404);
  if (!(await hasPermission(customData, 4))) {
    return ResponseHandler(res, "Nível de permissão insuficiente!", null, 403);
  }

  if (!req.body || !req.body.email || !req.body.nome || !req.body.senha) {
    return res.status(400).json({
      message: "Dados inválidos, revise as informações e tente novamente!",
    });
  }

  try {
    const hasId = req.body.id && Number(req.body.id) > 0 ? true : false;
    let data = null;
    const push =
      req.body.pushReceiver && req.body.pushReceiver === "on" ? true : false;
    const email =
      req.body.emailReceiver && req.body.emailReceiver === "on" ? true : false;

    if (hasId) {
      const user = await prisma.usuarios.findUnique({
        where: {
          id: Number(req.body.id),
        },
      });

      if (user?.permissao === "root") {
        req.body.permissao = "root";
      }

      data = await prisma.usuarios.update({
        where: {
          id: Number(req.body.id),
        },
        data: {
          emailReceiver: email,
          pushReceiver: push,
          contaId: customData.contaId,
          nome: req.body.nome,
          email: req.body.email,
          senha: req.body.senha,
          permissao: req.body.permissao,
          status: req.body.status,
        },
      });
    } else {
      data = await prisma.usuarios.create({
        data: {
          emailReceiver: email,
          pushReceiver: push,
          contaId: customData.contaId,
          nome: req.body.nome,
          email: req.body.email,
          senha: req.body.senha,
          permissao: req.body.permissao,
          status: req.body.status,
        },
      });
    }

    ResponseHandler(
      res,
      req.body.id
        ? "Usuário atualizado com sucesso"
        : "Usuário criado com sucesso",
      data,
      201
    );
  } catch (error) {
    handleError(res, error);
  }
};

export const getUsuario = async (req: Request, res: Response): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const { id } = req.params;
  try {
    const data = await prisma.usuarios.findFirst({
      where: {
        id: Number(id),
        contaId: customData.contaId,
      },
    });
    ResponseHandler(res, "Usuário encontrado", data, 200);
  } catch (error) {
    handleError(res, error);
  }
};
