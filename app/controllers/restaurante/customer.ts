import type { Request, Response } from "express";
import { z } from "zod";
import { CommerceError } from "../../services/loja/commerceError";
import { loginRestaurantCustomer, normalizeRestaurantPhone, registerRestaurantCustomer } from "../../services/restaurante/customerAuth";
import { prisma } from "../../utils/prisma";

const password = z.string().min(8, "A senha deve ter pelo menos 8 caracteres").max(100).regex(/[A-Za-z]/, "A senha deve conter letra").regex(/\d/, "A senha deve conter número");
const phone = z.string().trim().min(8).max(32).refine((value) => normalizeRestaurantPhone(value).length >= 10, "Informe um telefone válido");
const addressSchema = z.object({
  rotulo: z.string().trim().max(60).optional().nullable(),
  cep: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().length(8)),
  cidade: z.string().trim().min(2).max(120),
  bairro: z.string().trim().min(2).max(120),
  logradouro: z.string().trim().min(2).max(180),
  numero: z.string().trim().min(1).max(30),
  complemento: z.string().trim().max(120).optional().nullable(),
  referencia: z.string().trim().max(180).optional().nullable(),
  principal: z.boolean().optional(),
});

function fail(res: Response, error: unknown) {
  if (error instanceof CommerceError) return res.status(error.code === "unauthorized" ? 401 : error.code === "not_found" ? 404 : 422).json({ error: { code: error.code, message: error.message } });
  if (error instanceof z.ZodError) return res.status(422).json({ error: { code: "validation_error", message: "Dados inválidos", details: error.flatten() } });
  throw error;
}

async function identityForSlug(req: Request) {
  const identity = (req as any).restaurantCustomer as { id: number; contaId: number };
  const config = await prisma.restauranteConfig.findUnique({ where: { slug: req.params.slug }, select: { contaId: true } });
  if (!config || config.contaId !== identity.contaId) throw new CommerceError("not_found", "Conta não encontrada neste restaurante");
  return identity;
}

export async function registerRestaurantAccount(req: Request, res: Response) {
  try {
    const input = z.object({ nome: z.string().trim().min(2).max(160), telefone: phone, email: z.string().trim().email().max(190).optional().nullable(), senha: password }).parse(req.body);
    return res.status(201).json({ data: await registerRestaurantCustomer(req.params.slug, input) });
  } catch (error) { return fail(res, error); }
}

export async function loginRestaurantAccount(req: Request, res: Response) {
  try {
    const input = z.object({ telefone: phone, senha: z.string().min(1).max(100) }).parse(req.body);
    return res.json({ data: await loginRestaurantCustomer(req.params.slug, input.telefone, input.senha) });
  } catch (error) { return fail(res, error); }
}

export async function getRestaurantAccount(req: Request, res: Response) {
  try {
    const identity = await identityForSlug(req);
    const customer = await prisma.restauranteCliente.findFirst({
      where: { id: identity.id, contaId: identity.contaId },
      select: {
        id: true, nome: true, telefone: true, email: true, createdAt: true,
        enderecos: { orderBy: [{ principal: "desc" }, { updatedAt: "desc" }] },
        pedidos: {
          orderBy: { createdAt: "desc" }, take: 50,
          select: {
            codigo: true, origem: true, status: true, producaoStatus: true, pagamentoStatus: true, entregaStatus: true,
            subtotal: true, frete: true, total: true, createdAt: true, updatedAt: true, concluidoAt: true, canceladoAt: true,
            itens: { orderBy: { id: "asc" }, select: { nomeSnapshot: true, quantidade: true, subtotalSnapshot: true, selecoesSnapshotJson: true } },
          },
        },
      },
    });
    return res.json({ data: customer });
  } catch (error) { return fail(res, error); }
}

export async function updateRestaurantAccount(req: Request, res: Response) {
  try {
    const identity = await identityForSlug(req);
    const input = z.object({ nome: z.string().trim().min(2).max(160), email: z.string().trim().email().max(190).optional().nullable() }).parse(req.body);
    const customer = await prisma.restauranteCliente.update({ where: { id: identity.id }, data: { nome: input.nome, email: input.email?.toLowerCase() || null }, select: { id: true, nome: true, telefone: true, email: true } });
    return res.json({ data: customer });
  } catch (error) { return fail(res, error); }
}

export async function saveRestaurantAccountAddress(req: Request, res: Response) {
  try {
    const identity = await identityForSlug(req); const input = addressSchema.parse(req.body); const id = Number(req.params.id || 0);
    const address = await prisma.$transaction(async (tx) => {
      if (input.principal) await tx.restauranteClienteEndereco.updateMany({ where: { contaId: identity.contaId, restauranteClienteId: identity.id }, data: { principal: false } });
      if (!id) return tx.restauranteClienteEndereco.create({ data: { ...input, contaId: identity.contaId, restauranteClienteId: identity.id, principal: input.principal ?? false } });
      const current = await tx.restauranteClienteEndereco.findFirst({ where: { id, contaId: identity.contaId, restauranteClienteId: identity.id } });
      if (!current) throw new CommerceError("not_found", "Endereço não encontrado");
      return tx.restauranteClienteEndereco.update({ where: { id }, data: input });
    });
    return res.status(id ? 200 : 201).json({ data: address });
  } catch (error) { return fail(res, error); }
}

export async function deleteRestaurantAccountAddress(req: Request, res: Response) {
  try {
    const identity = await identityForSlug(req); const id = Number(req.params.id);
    const address = await prisma.restauranteClienteEndereco.findFirst({ where: { id, contaId: identity.contaId, restauranteClienteId: identity.id } });
    if (!address) throw new CommerceError("not_found", "Endereço não encontrado");
    await prisma.restauranteClienteEndereco.delete({ where: { id } });
    return res.json({ data: { id } });
  } catch (error) { return fail(res, error); }
}
