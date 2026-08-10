import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { RestaurantePapel } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { getRestauranteAccess } from "../../services/restaurante/access";
import { prisma } from "../../utils/prisma";

const rolesSchema = z.object({
  papeis: z.array(z.nativeEnum(RestaurantePapel)).max(5),
});

function requestId(req: Request) {
  return String(req.headers["x-request-id"] || randomUUID());
}

function ok(req: Request, res: Response, data: unknown) {
  return res.status(200).json({ data, requestId: requestId(req) });
}

function fail(req: Request, res: Response, status: number, code: string, message: string, details?: unknown) {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId: requestId(req) } });
}

export async function currentRestaurantAccess(req: Request, res: Response) {
  const access = await getRestauranteAccess(getCustomRequest(req).customData);
  return ok(req, res, access);
}

export async function listRestaurantUserRoles(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const users = await prisma.usuarios.findMany({
    where: { contaId },
    select: {
      id: true,
      nome: true,
      email: true,
      status: true,
      permissao: true,
      restaurantePapeis: { select: { papel: true }, orderBy: { papel: "asc" } },
    },
    orderBy: [{ status: "asc" }, { nome: "asc" }],
  });
  return ok(req, res, users.map((user) => ({ ...user, papeis: user.restaurantePapeis.map((entry) => entry.papel), restaurantePapeis: undefined })));
}

export async function saveRestaurantUserRoles(req: Request, res: Response) {
  const parsed = rolesSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(req, res, 422, "validation_error", "Papeis invalidos.", parsed.error.flatten());
  }
  const { contaId } = getCustomRequest(req).customData;
  const usuarioId = Number(req.params.usuarioId);
  const user = await prisma.usuarios.findFirst({ where: { id: usuarioId, contaId }, select: { id: true } });
  if (!user) return fail(req, res, 404, "user_not_found", "Usuario nao encontrado.");

  const papeis = [...new Set(parsed.data.papeis)];
  await prisma.$transaction(async (tx) => {
    await tx.restauranteUsuarioPapel.deleteMany({ where: { contaId, usuarioId } });
    if (papeis.length) {
      await tx.restauranteUsuarioPapel.createMany({
        data: papeis.map((papel) => ({ contaId, usuarioId, papel })),
      });
    }
    // Preserva o perfil/historico, mas a PWA ainda exige o papel a cada request.
    if (papeis.includes(RestaurantePapel.ENTREGADOR)) {
      await tx.restauranteEntregador.upsert({
        where: { contaId_usuarioId: { contaId, usuarioId } },
        create: { contaId, usuarioId },
        update: { ativo: true },
      });
    } else {
      await tx.restauranteEntregador.updateMany({ where: { contaId, usuarioId }, data: { ativo: false, disponivel: false } });
    }
  });
  return ok(req, res, { usuarioId, papeis });
}
