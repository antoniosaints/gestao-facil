import { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { verifyPassword } from "../../services/auth/passwordService";
import { handleError } from "../../utils/handleError";
import { JwtUtil, SUPPORT_TOKEN_TTL_SECONDS } from "../../utils/jwt";
import { prisma } from "../../utils/prisma";
import { redisConnecion } from "../../utils/redis";
import { assertSuperAdmin } from "./assinantes";

const iniciarAcessoSchema = z.object({
  senha: z.string().min(1, "Informe sua senha para continuar."),
  motivo: z
    .string()
    .trim()
    .min(10, "Descreva o motivo do atendimento (mínimo 10 caracteres).")
    .max(500, "Motivo muito longo."),
});

function getIp(req: Request) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return (forwarded || req.ip || "").slice(0, 190) || null;
}

function getUserAgent(req: Request) {
  return String(req.headers["user-agent"] || "").slice(0, 500) || null;
}

// Este endpoint recebe a senha do CEO, então precisa de teto de tentativas.
// Mesmo padrão do enforceStoreRateLimit (services/loja/lojaAuthService.ts:25),
// mas devolvendo 429 em vez de CommerceError, que só é tratado na loja.
async function excedeuTentativas(userId: number) {
  const chave = `suporte:rate:acessar:${userId}`;
  const tentativas = await redisConnecion.incr(chave);
  if (tentativas === 1) await redisConnecion.expire(chave, 900);
  return tentativas > 5;
}

/**
 * Abre uma sessão de suporte do superadmin dentro da conta de um assinante.
 *
 * O token emitido carrega a identidade do root alvo (id + contaId), o que faz as
 * queries do ERP — que filtram contaId manualmente — funcionarem sem alteração.
 * As claims imp/impBy/impSessao marcam a sessão para os guards e a auditoria.
 */
export const iniciarAcessoSuporte = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;

    if (!(await assertSuperAdmin(customData.userId))) {
      return res.status(403).json({
        message: "Usuário não tem permissão para acessar contas de assinantes.",
      });
    }

    const contaId = Number(req.params.id);
    if (!contaId) {
      return res.status(400).json({ message: "Conta inválida." });
    }

    if (contaId === customData.contaId) {
      return res.status(400).json({
        message: "Você já está na sua própria conta.",
      });
    }

    const parsed = iniciarAcessoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    if (await excedeuTentativas(customData.userId)) {
      return res.status(429).json({
        message: "Muitas tentativas de acesso. Aguarde alguns minutos antes de tentar de novo.",
      });
    }

    // A senha é conferida aqui, no mesmo request que emite o token: validar antes
    // por /auth/senha deixaria uma janela TOCTOU entre a confirmação e a emissão.
    const superAdmin = await prisma.usuarios.findUniqueOrThrow({
      where: { id: customData.userId },
      select: { id: true, nome: true, email: true, senha: true },
    });

    if (!(await verifyPassword(parsed.data.senha, superAdmin.senha))) {
      return res.status(401).json({ message: "Senha incorreta." });
    }

    await redisConnecion.del(`suporte:rate:acessar:${customData.userId}`);

    const conta = await prisma.contas.findUnique({
      where: { id: contaId },
      select: { id: true, nome: true, status: true },
    });

    if (!conta) {
      return res.status(404).json({ message: "Conta não encontrada." });
    }

    // superAdmin: false no filtro impede impersonar outro superadmin — o que
    // reabriria o painel CEO em nome do assinante e permitiria acesso em cadeia.
    const alvos = await prisma.usuarios.findMany({
      where: {
        contaId,
        permissao: "root",
        status: "ATIVO",
        superAdmin: false,
      },
      select: { id: true, nome: true, email: true, permissao: true },
      orderBy: { id: "asc" },
    });

    if (!alvos.length) {
      return res.status(400).json({
        message: "Esta conta não possui um usuário root ativo elegível para acesso de suporte.",
      });
    }

    const alvo = alvos[0];
    const expiraEm = new Date(Date.now() + SUPPORT_TOKEN_TTL_SECONDS * 1000);

    const sessao = await prisma.acessoSuporteLog.create({
      data: {
        contaId: conta.id,
        contaNome: conta.nome,
        superAdminId: superAdmin.id,
        superAdminNome: superAdmin.nome,
        superAdminEmail: superAdmin.email,
        usuarioAlvoId: alvo.id,
        usuarioAlvoEmail: alvo.email,
        motivo: parsed.data.motivo,
        ip: getIp(req),
        userAgent: getUserAgent(req),
        expiraEm,
      },
    });

    // Sem refreshToken: a sessão de suporte morre em SUPPORT_TOKEN_TTL_SECONDS e
    // precisa ser reaberta pelo painel, gerando um novo registro de auditoria.
    const token = JwtUtil.encode(
      {
        id: alvo.id,
        contaId: conta.id,
        permissao: alvo.permissao,
        nome: alvo.nome,
        email: alvo.email,
        imp: true,
        impBy: superAdmin.id,
        impSessao: sessao.id,
      },
      SUPPORT_TOKEN_TTL_SECONDS,
    );

    console.warn(
      `[suporte] Superadmin ${superAdmin.id} (${superAdmin.email}) iniciou acesso à conta ${conta.id} (${conta.nome}) como ${alvo.email}. Sessão ${sessao.id}. Motivo: ${parsed.data.motivo}`,
    );

    return res.status(201).json({
      message: `Acesso de suporte iniciado na conta ${conta.nome}.`,
      data: {
        token,
        sessaoId: sessao.id,
        expiraEm,
        conta: { id: conta.id, nome: conta.nome, status: conta.status },
        usuarioAlvo: { id: alvo.id, nome: alvo.nome, email: alvo.email },
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * Encerra a sessão de suporte atual. Fica fora de /api/admin de propósito: com o
 * token de suporte ativo o blockImpersonation barraria o próprio encerramento.
 */
export const encerrarAcessoSuporte = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;

    if (!customData.impersonacao) {
      return res.status(400).json({ message: "Nenhuma sessão de suporte ativa." });
    }

    await prisma.acessoSuporteLog.updateMany({
      where: {
        id: customData.impersonacao.sessaoId,
        encerradoEm: null,
      },
      data: {
        encerradoEm: new Date(),
        encerradoPor: "CEO",
      },
    });

    console.warn(
      `[suporte] Sessão ${customData.impersonacao.sessaoId} encerrada pelo superadmin ${customData.impersonacao.superAdminId}`,
    );

    return res.json({ message: "Sessão de suporte encerrada." });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listarAcessosSuporte = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;

    if (!(await assertSuperAdmin(customData.userId))) {
      return res.status(403).json({
        message: "Usuário não tem permissão para visualizar esses dados.",
      });
    }

    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const pageSize = Number(req.query.pageSize) > 0 ? Number(req.query.pageSize) : 10;
    const search = String(req.query.search || "").trim();

    const where: Prisma.AcessoSuporteLogWhereInput = {};
    if (search) {
      where.OR = [
        { contaNome: { contains: search } },
        { superAdminEmail: { contains: search } },
        { usuarioAlvoEmail: { contains: search } },
        { motivo: { contains: search } },
      ];
    }

    const [total, registros] = await Promise.all([
      prisma.acessoSuporteLog.count({ where }),
      prisma.acessoSuporteLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { iniciadoEm: "desc" },
      }),
    ]);

    const agora = new Date();
    const data = registros.map((registro) => ({
      ...registro,
      Uid: `#${registro.id}`,
      ativa: !registro.encerradoEm && registro.expiraEm > agora,
    }));

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

/** Kill switch: derruba na hora uma sessão de suporte em andamento. */
export const revogarAcessoSuporte = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;

    if (!(await assertSuperAdmin(customData.userId))) {
      return res.status(403).json({
        message: "Usuário não tem permissão para revogar acessos.",
      });
    }

    const sessaoId = Number(req.params.id);
    if (!sessaoId) {
      return res.status(400).json({ message: "Sessão inválida." });
    }

    const revogadas = await prisma.acessoSuporteLog.updateMany({
      where: {
        id: sessaoId,
        encerradoEm: null,
      },
      data: {
        encerradoEm: new Date(),
        encerradoPor: "REVOGADO",
      },
    });

    if (!revogadas.count) {
      return res.status(404).json({
        message: "Sessão não encontrada ou já encerrada.",
      });
    }

    console.warn(
      `[suporte] Sessão ${sessaoId} REVOGADA pelo superadmin ${customData.userId}`,
    );

    return res.json({ message: "Sessão de suporte revogada." });
  } catch (error) {
    return handleError(res, error);
  }
};
