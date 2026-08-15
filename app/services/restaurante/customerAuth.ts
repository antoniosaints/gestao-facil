import jwt from "jsonwebtoken";
import { env } from "../../utils/dotenv";
import { prisma } from "../../utils/prisma";
import { hashPassword, verifyPassword } from "../auth/passwordService";
import { contaHasActiveModule } from "../contas/storeModulesService";
import { CommerceError } from "../loja/commerceError";

export type RestaurantCustomerIdentity = { id: number; contaId: number };

export function normalizeRestaurantPhone(value: string) {
  return value.replace(/\D/g, "");
}

async function resolveRestaurant(slug: string) {
  const config = await prisma.restauranteConfig.findUnique({ where: { slug } });
  if (!config || !config.ativo || !(await contaHasActiveModule(config.contaId, "restaurante-delivery"))) {
    throw new CommerceError("not_found", "Cardápio indisponível");
  }
  return config;
}

function secret() {
  if (!env.LOJA_CUSTOMER_JWT_SECRET) {
    throw new CommerceError("gateway_unavailable", "Autenticação de clientes não configurada");
  }
  return env.LOJA_CUSTOMER_JWT_SECRET;
}

function issueAccessToken(customer: RestaurantCustomerIdentity) {
  return jwt.sign({ sub: customer.id, contaId: customer.contaId }, secret(), {
    expiresIn: "30d",
    audience: "restaurante-cliente",
  });
}

export async function registerRestaurantCustomer(slug: string, input: { nome: string; telefone: string; email?: string | null; senha: string }) {
  const config = await resolveRestaurant(slug);
  const telefoneNormalizado = normalizeRestaurantPhone(input.telefone);
  const exists = await prisma.restauranteCliente.findUnique({
    where: { contaId_telefoneNormalizado: { contaId: config.contaId, telefoneNormalizado } },
  });
  if (exists) throw new CommerceError("validation_failed", "Já existe uma conta com este número de telefone");
  const customer = await prisma.restauranteCliente.create({
    data: {
      contaId: config.contaId,
      nome: input.nome.trim(),
      telefone: input.telefone.trim(),
      telefoneNormalizado,
      email: input.email?.trim().toLowerCase() || null,
      senhaHash: await hashPassword(input.senha),
    },
  });
  return { customer: { id: customer.id, nome: customer.nome, telefone: customer.telefone }, accessToken: issueAccessToken(customer) };
}

export async function loginRestaurantCustomer(slug: string, telefone: string, senha: string) {
  const config = await resolveRestaurant(slug);
  const customer = await prisma.restauranteCliente.findUnique({
    where: { contaId_telefoneNormalizado: { contaId: config.contaId, telefoneNormalizado: normalizeRestaurantPhone(telefone) } },
  });
  if (!customer || !(await verifyPassword(senha, customer.senhaHash))) {
    throw new CommerceError("unauthorized", "Telefone ou senha inválidos");
  }
  return { customer: { id: customer.id, nome: customer.nome, telefone: customer.telefone }, accessToken: issueAccessToken(customer) };
}

export async function decodeRestaurantCustomerAccessToken(token: string): Promise<RestaurantCustomerIdentity | null> {
  try {
    const payload = jwt.verify(token, secret(), { audience: "restaurante-cliente" }) as jwt.JwtPayload;
    const id = Number(payload.sub);
    const contaId = Number(payload.contaId);
    if (!Number.isInteger(id) || !Number.isInteger(contaId)) return null;
    const customer = await prisma.restauranteCliente.findFirst({ where: { id, contaId }, select: { id: true, contaId: true } });
    return customer;
  } catch {
    return null;
  }
}
