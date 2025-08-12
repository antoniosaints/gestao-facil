import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { PrismaDataTableBuilder } from "../../services/prismaDatatables";
import { usuariosAcoes } from "./acoes";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { PermissaoUsuario, Prisma, Usuarios } from "../../../generated";
import { formatLabel } from "../../helpers/formatters";
import { isAccountOverdue } from "../../routers/web";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";
import { hasPermission } from "../../helpers/userPermission";
export const tableUsuarios = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const builder = new PrismaDataTableBuilder<Usuarios>(prisma.usuarios)
    .where({
      OR: [
        {
          contaId: customData.contaId,
        },
      ],
    })
    .search({
      nome: "string",
      email: "string",
    })
    .format("nome", function (row) {
      return `<span class="px-2 py-1 flex items-center gap-2 flex-nowrap cursor-pointer w-max border border-gray-700 text-gray-900 bg-gray-100 dark:border-gray-500 dark:bg-gray-950 dark:text-gray-100 rounded-md"><i class="fa-solid fa-user"></i> ${row}</span>`;
    })
    .format("email", function (row) {
      const email = row || "-";
      return `<span class="px-2 py-1.5">${email}</span>`;
    })
    .format("permissao", function (row: PermissaoUsuario) {
      let color = "";

      switch (row) {
        case "root":
          color = "purple";
          break;
        case "admin":
          color = "orange";
          break;
        case "gerente":
          color = "green";
          break;
        case "tecnico":
        case "vendedor":
          color = "red";
          break;
        case "usuario":
          color = "blue";
          break;
      }

      return formatLabel(row, color, "fa-solid fa-user-lock");
    })
    .format("emailReceiver", function (row) {
      return `
              <label class="flex items-center cursor-pointer">
                <input type="checkbox" value="" class="sr-only peer" ${
                  row ? "checked" : ""
                }>
                <div class="relative w-11 h-6 bg-red-200 peer-focus:outline-none rounded-full peer dark:bg-red-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-red-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-red-600 peer-checked:bg-emerald-600 dark:peer-checked:bg-emerald-600"></div>
              </label>
              `;
    })
    .format("pushReceiver", function (row) {
      return `
              <label class="flex items-center cursor-pointer">
                <input type="checkbox" value="" class="sr-only peer" ${
                  row ? "checked" : ""
                }>
                <div class="relative w-11 h-6 bg-red-200 peer-focus:outline-none rounded-full peer dark:bg-red-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-red-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-red-600 peer-checked:bg-emerald-600 dark:peer-checked:bg-emerald-600"></div>
              </label>
              `;
    })
    .format("status", function (value) {
      return `
              <label class="flex items-center cursor-pointer">
                <input type="checkbox" value="" class="sr-only peer" ${
                  value === "ATIVO" ? "checked" : ""
                }>
                <div class="relative w-11 h-6 bg-red-200 peer-focus:outline-none rounded-full peer dark:bg-red-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-red-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-red-600 peer-checked:bg-emerald-600 dark:peer-checked:bg-emerald-600"></div>
              </label>
              `;
    })
    .addColumn("acoes", (row) => {
      return usuariosAcoes(row);
    });
  const data = await builder.toJson(req.query);
  return res.json(data);
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
