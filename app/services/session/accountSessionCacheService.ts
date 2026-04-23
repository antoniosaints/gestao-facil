import { prisma } from "../../utils/prisma";
import { redisConnecion } from "../../utils/redis";

export function getContaInfoCacheKey(contaId: number) {
  return `infoconta:conta${contaId}`;
}

export function getContaStatusCacheKey(contaId: number) {
  return `assinaturaconta:conta${contaId}`;
}

export function getUserSessionCacheKey(userId: number, contaId: number) {
  return `minhaconexao:${userId}:${contaId}`;
}

export async function refreshContaInfoCache(contaId: number) {
  const conta = await prisma.contas.findFirst({
    where: { id: contaId },
    include: {
      Usuarios: true,
    },
  });

  if (!conta) {
    await redisConnecion.del(getContaInfoCacheKey(contaId));
    return null;
  }

  await redisConnecion.set(getContaInfoCacheKey(contaId), JSON.stringify(conta), "EX", 3600);
  return conta;
}

export async function refreshUserSessionCache(contaId: number, userId: number) {
  const usuario = await prisma.usuarios.findUnique({
    where: {
      id: userId,
      contaId,
    },
  });

  const cacheKey = getUserSessionCacheKey(userId, contaId);

  if (!usuario) {
    await redisConnecion.del(cacheKey);
    return null;
  }

  await redisConnecion.set(cacheKey, JSON.stringify(usuario), "EX", 3600);
  return usuario;
}

export async function refreshAllUserSessionCaches(contaId: number) {
  const usuarios = await prisma.usuarios.findMany({
    where: { contaId },
    select: { id: true },
  });

  await Promise.all(usuarios.map((usuario) => refreshUserSessionCache(contaId, usuario.id)));
  return usuarios.length;
}

export async function clearContaStatusCache(contaId: number) {
  await redisConnecion.del(getContaStatusCacheKey(contaId));
}

export async function syncContaSessionCaches(
  contaId: number,
  options?: {
    refreshUsers?: boolean;
  },
) {
  await refreshContaInfoCache(contaId);
  await clearContaStatusCache(contaId);

  if (options?.refreshUsers) {
    await refreshAllUserSessionCaches(contaId);
  }
}

export async function syncAuthenticatedSessionCaches(contaId: number, userId: number) {
  await Promise.all([
    refreshContaInfoCache(contaId),
    refreshUserSessionCache(contaId, userId),
    clearContaStatusCache(contaId),
  ]);
}

export async function clearAuthenticatedSessionCache(contaId: number, userId: number) {
  await Promise.all([
    redisConnecion.del(getContaInfoCacheKey(contaId)),
    redisConnecion.del(getContaStatusCacheKey(contaId)),
    redisConnecion.del(getUserSessionCacheKey(userId, contaId)),
  ]);
}
