import type { Request, Response } from "express";
import { z } from "zod";
import { sendCommerceError } from "../../services/loja/commerceError";
import { enforceStoreRateLimit, loginStoreCustomer, logoutStoreCustomer, refreshStoreCustomer, registerStoreCustomer, requestStorePasswordReset, resetStorePassword, verifyStoreCustomerEmail } from "../../services/loja/lojaAuthService";
import { ResponseHandler } from "../../utils/response";
import { prisma } from "../../utils/prisma";

const password = z.string().min(8).max(100).regex(/[A-Za-z]/).regex(/\d/);
const cookie = (req: Request, name: string) => req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
const setRefreshCookie = (res: Response, value: string) => res.cookie("loja_refresh", value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/loja/publica", maxAge: 30 * 24 * 60 * 60 * 1000 });

export async function register(req: Request, res: Response) { try {
  await enforceStoreRateLimit("register", `${req.params.slug}:${req.ip}`);
  const body = z.object({ name: z.string().min(2).max(120), email: z.string().email(), phone: z.string().max(30).optional(), password }).parse(req.body);
  const result = await registerStoreCustomer(req.params.slug, body, { userAgent: req.headers["user-agent"], ip: req.ip });
  setRefreshCookie(res, result.refreshToken);
  return ResponseHandler(res, "Cadastro realizado", { customer: result.customer, accessToken: result.accessToken }, 201);
} catch (error) { return sendCommerceError(res, error); } }

export async function verify(req: Request, res: Response) { try {
  const body = z.object({ token: z.string().min(20) }).parse(req.body);
  await verifyStoreCustomerEmail(req.params.slug, body.token);
  return ResponseHandler(res, "E-mail verificado");
} catch (error) { return sendCommerceError(res, error); } }

export async function login(req: Request, res: Response) { try {
  await enforceStoreRateLimit("login", `${req.params.slug}:${req.ip}`);
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const result = await loginStoreCustomer(req.params.slug, body.email, body.password, { userAgent: req.headers["user-agent"], ip: req.ip });
  setRefreshCookie(res, result.refreshToken);
  return ResponseHandler(res, "Login realizado", { customer: result.customer, accessToken: result.accessToken });
} catch (error) { return sendCommerceError(res, error); } }

export async function refresh(req: Request, res: Response) { try {
  const result = await refreshStoreCustomer(cookie(req, "loja_refresh") || "");
  setRefreshCookie(res, result.refreshToken);
  return ResponseHandler(res, "Sessão renovada", { accessToken: result.accessToken });
} catch (error) { return sendCommerceError(res, error); } }

export async function logout(req: Request, res: Response) { try {
  await logoutStoreCustomer(cookie(req, "loja_refresh") || "");
  res.clearCookie("loja_refresh", { path: "/api/loja/publica" });
  return ResponseHandler(res, "Sessão encerrada");
} catch (error) { return sendCommerceError(res, error); } }

export async function forgotPassword(req: Request, res: Response) { try {
  await enforceStoreRateLimit("forgot", `${req.params.slug}:${req.ip}`, 5, 3600);
  const body = z.object({ email: z.string().email() }).parse(req.body);
  await requestStorePasswordReset(req.params.slug, body.email);
  return ResponseHandler(res, "Se o e-mail existir, enviaremos as instruções");
} catch (error) { return sendCommerceError(res, error); } }

export async function resetPassword(req: Request, res: Response) { try {
  const body = z.object({ token: z.string().min(20), password }).parse(req.body);
  await resetStorePassword(req.params.slug, body.token, body.password);
  res.clearCookie("loja_refresh", { path: "/api/loja/publica" });
  return ResponseHandler(res, "Senha redefinida. Entre novamente");
} catch (error) { return sendCommerceError(res, error); } }

export async function me(req: Request, res: Response) { try {
  const identity = (req as any).storeCustomer;
  const customer = await prisma.lojaCliente.findFirst({ where: { id: identity.id, contaId: identity.contaId }, select: { id: true, nome: true, email: true, telefone: true, enderecos: true, pedidos: { orderBy: { createdAt: "desc" }, take: 30, include: { itens: true } } } });
  return ResponseHandler(res, "Cliente encontrado", customer);
} catch (error) { return sendCommerceError(res, error); } }

const addressSchema = z.object({ label: z.string().max(40).optional(), recipient: z.string().min(2).max(120), postalCode: z.string().min(8).max(12), address: z.string().min(2).max(160), number: z.string().min(1).max(30), complement: z.string().max(100).optional(), district: z.string().min(2).max(100), city: z.string().min(2).max(100), state: z.string().length(2), primary: z.boolean().optional() });

export async function saveAddress(req: Request, res: Response) { try {
  const identity = (req as any).storeCustomer; const body = addressSchema.parse(req.body); const id = req.params.id ? Number(req.params.id) : null;
  const data = { rotulo: body.label, destinatario: body.recipient, cep: body.postalCode, endereco: body.address, numero: body.number, complemento: body.complement, bairro: body.district, cidade: body.city, estado: body.state.toUpperCase(), principal: body.primary ?? false };
  const address = await prisma.$transaction(async (tx) => {
    if (data.principal) await tx.lojaClienteEndereco.updateMany({ where: { contaId: identity.contaId, lojaClienteId: identity.id }, data: { principal: false } });
    if (id) {
      const found = await tx.lojaClienteEndereco.findFirst({ where: { id, contaId: identity.contaId, lojaClienteId: identity.id } });
      if (!found) throw new Error("Endereço não encontrado");
      return tx.lojaClienteEndereco.update({ where: { id }, data });
    }
    return tx.lojaClienteEndereco.create({ data: { contaId: identity.contaId, lojaClienteId: identity.id, ...data } });
  });
  return ResponseHandler(res, "Endereço salvo", address, id ? 200 : 201);
} catch (error) { return sendCommerceError(res, error); } }

export async function deleteAddress(req: Request, res: Response) { try {
  const identity = (req as any).storeCustomer;
  const address = await prisma.lojaClienteEndereco.findFirst({ where: { id: Number(req.params.id), contaId: identity.contaId, lojaClienteId: identity.id } });
  if (!address) return ResponseHandler(res, "Endereço não encontrado", null, 404);
  await prisma.lojaClienteEndereco.delete({ where: { id: address.id } });
  return ResponseHandler(res, "Endereço removido");
} catch (error) { return sendCommerceError(res, error); } }
