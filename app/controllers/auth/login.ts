import { Request, Response } from "express";
import { handleError } from "../../utils/handleError";
import { loginSchema } from "../../schemas/login";
import { prisma } from "../../utils/prisma";
import { JwtUtil } from "../../utils/jwt";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import {
  hashPassword,
  isPasswordHashed,
  verifyPassword,
} from "../../services/auth/passwordService";

// Faz a migração preguiçosa: se a senha conferida ainda estava em texto puro,
// reescreve com hash bcrypt. Nunca deixa a falha da migração quebrar o login.
async function upgradeLegacyPassword(userId: number, storedSenha: string | null, plainSenha: string) {
  if (isPasswordHashed(storedSenha)) return;
  try {
    const hashed = await hashPassword(plainSenha);
    await prisma.usuarios.update({ where: { id: userId }, data: { senha: hashed } });
  } catch (error) {
    console.error("[auth] Falha ao migrar senha para hash:", error);
  }
}

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

    // Busca por e-mail e valida a senha aceitando hash ou texto puro (legado).
    // findMany cobre o caso raro de e-mails repetidos entre contas diferentes.
    const candidatos = await prisma.usuarios.findMany({
      where: {
        email: validated.data.email,
      },
    });

    let usuario: (typeof candidatos)[number] | null = null;
    for (const candidato of candidatos) {
      if (await verifyPassword(validated.data.senha, candidato.senha)) {
        usuario = candidato;
        break;
      }
    }

    if (!usuario) {
      return res.status(401).json({
        status: 401,
        message: "Usuário não encontrado",
        data: null,
      });
    }

    await upgradeLegacyPassword(usuario.id, usuario.senha, validated.data.senha);

    const jwtToken = JwtUtil.encode({
      id: usuario.id,
      contaId: usuario.contaId,
      permissao: usuario.permissao,
      nome: usuario.nome,
      email: usuario.email,
      tv: usuario.tokenVersion,
    });

    const refreshToken = JwtUtil.encode({
      id: usuario.id,
      contaId: usuario.contaId,
      email: usuario.email,
      tv: usuario.tokenVersion,
    }, '7d');

    return res.status(200).json({
      status: 200,
      message: "Login realizado com sucesso",
      data: {
        id: usuario.id,
        nome: usuario.nome,
        permissao: usuario.permissao,
        email: usuario.email,
        token: jwtToken,
        refreshToken
      },
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const verificarSenha = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    if (!customData?.userId) {
      return res.status(401).json({
        status: 401,
        message: "Sessão inválida",
        data: null,
      });
    }

    const senha = req.body?.senha;
    if (!senha || typeof senha !== "string") {
      return res.status(400).json({
        status: 400,
        message: "Informe a senha para continuar",
        data: null,
      });
    }

    const usuario = await prisma.usuarios.findFirst({
      where: {
        id: customData.userId,
        contaId: customData.contaId,
      },
      select: { id: true, senha: true },
    });

    if (!usuario || !(await verifyPassword(senha, usuario.senha))) {
      return res.status(401).json({
        status: 401,
        message: "Senha incorreta",
        data: null,
      });
    }

    await upgradeLegacyPassword(usuario.id, usuario.senha, senha);

    return res.status(200).json({
      status: 200,
      message: "Senha válida",
      data: { valid: true },
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
export const renewToken = async (req: Request, res: Response): Promise<any> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      authenticated: false,
      message: "Token inválido ou não informado",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decodeToken = JwtUtil.verify(token);

    if (!decodeToken) {
      return res.status(401).json({
        authenticated: false,
        returnLogin: true,
        message: "Token inválido ou expirado",
      });
    }

    // Sessão de suporte não se renova: este endpoint recarrega o usuário do banco
    // e reemite access + refresh SEM as claims `imp`, o que transformaria um token
    // de suporte de 1h numa sessão root irrestrita de 7 dias, sem motivo e fora da
    // auditoria. Ao expirar, o superadmin abre um novo acesso pelo painel CEO.
    if (decodeToken.imp === true) {
      return res.status(401).json({
        authenticated: false,
        supportEnded: true,
        message: "Sessão de suporte não pode ser renovada",
      });
    }

    const usuario = await prisma.usuarios.findFirstOrThrow({
      where: {
        id: decodeToken.id,
      },
    });

    if (!usuario) {
      return res.status(401).json({
        authenticated: false,
        returnLogin: true,
        message: "Erro ao renovar o token, entre em contato com o administrador",
      });
    }

    // Se a senha foi trocada depois deste token, o tokenVersion diverge e a
    // sessão não pode mais ser renovada.
    if ((usuario.tokenVersion ?? 0) !== (decodeToken.tv ?? 0)) {
      return res.status(401).json({
        authenticated: false,
        returnLogin: true,
        sessionRevoked: true,
        message: "Sessão expirada, faça login novamente",
      });
    }

    const jwtToken = JwtUtil.encode({
      id: usuario.id,
      contaId: usuario.contaId,
      permissao: usuario.permissao,
      nome: usuario.nome,
      email: usuario.email,
      tv: usuario.tokenVersion,
    });

    const refreshToken = JwtUtil.encode({
      id: usuario.id,
      contaId: usuario.contaId,
      email: usuario.email,
      tv: usuario.tokenVersion,
    }, '7d');

    return res.status(200).json({
      status: 200,
      message: "Login realizado com sucesso",
      data: {
        id: usuario.id,
        nome: usuario.nome,
        permissao: usuario.permissao,
        email: usuario.email,
        token: jwtToken,
        refreshToken
      },
    });
  } catch (error) {
    handleError(res, error);
  }
};
