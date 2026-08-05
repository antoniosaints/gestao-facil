import type { Request, Response } from "express";
import { z } from "zod";
import { RestaurantePapel } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { getRestauranteAccess } from "../../services/restaurante/access";
import { prisma } from "../../utils/prisma";

const rolesSchema = z.object({
  papeis: z.array(z.nativeEnum(RestaurantePapel)).max(5),
});

export async function currentRestaurantAccess(req: Request, res: Response) {
  const access = await getRestauranteAccess(getCustomRequest(req).customData);
  return res.status(200).json({ status: 200, message: "Acesso carregado.", data: access });
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
  return res.status(200).json({
    status: 200,
    message: "Papeis carregados.",
    data: users.map((user) => ({ ...user, papeis: user.restaurantePapeis.map((entry) => entry.papel), restaurantePapeis: undefined })),
  });
}

export async function saveRestaurantUserRoles(req: Request, res: Response) {
  const parsed = rolesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ status: 422, message: "Papeis invalidos.", data: null, error: parsed.error.flatten() });
  }
  const { contaId } = getCustomRequest(req).customData;
  const usuarioId = Number(req.params.usuarioId);
  const user = await prisma.usuarios.findFirst({ where: { id: usuarioId, contaId }, select: { id: true } });
  if (!user) return res.status(404).json({ status: 404, message: "Usuario nao encontrado.", data: null });

  const papeis = [...new Set(parsed.data.papeis)];
  await prisma.$transaction(async (tx) => {
    await tx.restauranteUsuarioPapel.deleteMany({ where: { contaId, usuarioId } });
    if (papeis.length) {
      await tx.restauranteUsuarioPapel.createMany({
        data: papeis.map((papel) => ({ contaId, usuarioId, papel })),
      });
    }
  });
  return res.status(200).json({ status: 200, message: "Papeis atualizados.", data: { usuarioId, papeis } });
}
