import { Request, Response } from "express";
import { handleError } from "../../utils/handleError";
import { loginSchema } from "../../schemas/login";
import { prisma } from "../../utils/prisma";
import { JwtUtil } from "../../utils/jwt";
import { getCustomRequest } from "../../helpers/getCustomRequest";

export const login = async (req: Request, res: Response): Promise<any> => {
  try {
    const data = req.body;
    const validated = loginSchema.safeParse(data);
    if (!validated.data?.email || !validated.data?.senha) {
      return res.status(401).json({
        status: 401,
        message: "Dados de login inválidos",
        data: null,
      });
    }

    const usuario = await prisma.usuarios.findFirst({
      where: {
        email: validated.data.email,
        senha: validated.data.senha,
      },
    });

    if (!usuario) {
      return res.status(401).json({
        status: 401,
        message: "Usuário não encontrado",
        data: null,
      });
    }

    const jwtToken = JwtUtil.encode({
      id: usuario.id,
      contaId: usuario.contaId,
      permissao: usuario.permissao,
      nome: usuario.nome,
      email: usuario.email,
    });

    res.cookie("gestao_facilpermissao", usuario.permissao, {
      httpOnly: false,
      secure: true,
      sameSite: "strict",
      maxAge: 1000 * 60 * 60 * 24,
    });

    return res.status(200).json({
      status: 200,
      message: "Login realizado com sucesso",
      data: {
        id: usuario.id,
        nome: usuario.nome,
        permissao: usuario.permissao,
        email: usuario.email,
        token: jwtToken,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const checkAuth = async (req: Request, res: Response): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  try {
    const usuario = await prisma.usuarios.findUniqueOrThrow({
      where: {
        id: customData.userId,
        contaId: customData.contaId,
      },
      include: {
        Contas: true,
      },
    });
    if (!usuario) {
      return res.status(401).json({
        authenticated: false,
        message: "Usuário nao encontrado",
      });
    };

    if (usuario.superAdmin && usuario.gerencialMode) {
      return res.status(200).json({
        authenticated: true,
        message: "Token valido",
        view: "/gerencia/dashboard",
      });
    }

    return res.status(200).json({
      authenticated: true,
      message: "Token válido",
      view: "/resumos",
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const verify = async (req: Request, res: Response): Promise<any> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      authenticated: false,
      message: "Token inválido ou não informado",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = JwtUtil.verify(token);
    if (payload) {
      return res.status(200).json({
        authenticated: true,
        message: "Token válido",
      });
    }
    return res.status(401).json({
      authenticated: false,
      message: "Token inválido",
    });
  } catch {
    return res.status(401).json({
      authenticated: false,
      message: "Token inválido",
    });
  }
};
