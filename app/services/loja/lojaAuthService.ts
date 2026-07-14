import { createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../utils/prisma";
import { env } from "../../utils/dotenv";
import { redisConnecion } from "../../utils/redis";
import { hashPassword, verifyPassword } from "../auth/passwordService";
import { CommerceError } from "./commerceError";
import { contaHasActiveModule } from "../contas/storeModulesService";
import { emailScheduleQueue } from "../../queues/emailScheduleQueue";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";

const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
const customerSecret = () => {
  if (!env.LOJA_CUSTOMER_JWT_SECRET) throw new CommerceError("gateway_unavailable", "Autenticação de clientes não configurada");
  return env.LOJA_CUSTOMER_JWT_SECRET;
};

async function resolveStore(slug: string) {
  const config = await prisma.lojaVirtualConfig.findUnique({ where: { slug } });
  if (!config) throw new CommerceError("not_found", "Loja não encontrada");
  if (!(await contaHasActiveModule(config.contaId, "loja-virtual"))) throw new CommerceError("commerce_module_inactive", "O módulo Loja Virtual não está ativo");
  return config;
}

export async function enforceStoreRateLimit(scope: string, key: string, max = 8, seconds = 900) {
  const redisKey = `loja:rate:${scope}:${tokenHash(key).slice(0, 24)}`;
  const count = await redisConnecion.incr(redisKey);
  if (count === 1) await redisConnecion.expire(redisKey, seconds);
  if (count > max) throw new CommerceError("rate_limited", "Muitas tentativas. Aguarde antes de tentar novamente");
}

function createAccessToken(customer: { id: number; contaId: number; email: string }, sessionId: number) {
  return jwt.sign({ sub: customer.id, contaId: customer.contaId, email: customer.email, sessionId, audience: "loja-cliente" }, customerSecret(), { expiresIn: "15m" });
}

async function createSession(customer: { id: number; contaId: number; email: string }, context: { userAgent?: string; ip?: string }) {
  const refreshToken = randomBytes(48).toString("base64url");
  const session = await prisma.lojaClienteSessao.create({
    data: { contaId: customer.contaId, lojaClienteId: customer.id, refreshTokenHash: tokenHash(refreshToken), userAgent: context.userAgent, ip: context.ip, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  });
  return { accessToken: createAccessToken(customer, session.id), refreshToken };
}

async function issueCustomerToken(customer: { id: number; contaId: number; email: string }, type: "VERIFICACAO_EMAIL" | "REDEFINICAO_SENHA") {
  const token = randomBytes(32).toString("base64url");
  await prisma.lojaClienteToken.create({
    data: { contaId: customer.contaId, lojaClienteId: customer.id, tipo: type, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + (type === "VERIFICACAO_EMAIL" ? 24 : 1) * 60 * 60 * 1000) },
  });
  return token;
}

async function enqueueCustomerEmail(to: string, subject: string, link: string) {
  await emailScheduleQueue.add("loja-cliente", { to, subject, text: `${subject}\n\n${link}\n\nSe você não solicitou esta ação, ignore esta mensagem.` }, { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true });
}

export async function registerStoreCustomer(slug: string, input: { name: string; email: string; phone?: string; password: string }) {
  const config = await resolveStore(slug);
  if (!config.permitirCadastro) throw new CommerceError("validation_failed", "Cadastro não habilitado nesta loja");
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.lojaCliente.findUnique({ where: { contaId_emailNormalizado: { contaId: config.contaId, emailNormalizado: email } } });
  if (existing) throw new CommerceError("validation_failed", "Já existe um cadastro com este e-mail");
  const senhaHash = await hashPassword(input.password);
  const customer = await prisma.$transaction(async (tx) => {
    const erpCustomer = await tx.clientesFornecedores.create({ data: { contaId: config.contaId, Uid: gerarIdUnicoComMetaFinal("CLI"), nome: input.name, email, telefone: input.phone, tipo: "CLIENTE" } });
    return tx.lojaCliente.create({ data: { contaId: config.contaId, clienteId: erpCustomer.id, nome: input.name, email, emailNormalizado: email, telefone: input.phone, senhaHash } });
  });
  const token = await issueCustomerToken(customer, "VERIFICACAO_EMAIL");
  await enqueueCustomerEmail(email, "Verifique seu e-mail", `${env.BASE_URL_FRONTEND}/lojas/${slug}/verificar?token=${token}`);
  return { id: customer.id, email: customer.email, verificationRequired: true };
}

export async function verifyStoreCustomerEmail(slug: string, token: string) {
  const config = await resolveStore(slug);
  const record = await prisma.lojaClienteToken.findFirst({ where: { contaId: config.contaId, tipo: "VERIFICACAO_EMAIL", tokenHash: tokenHash(token), consumedAt: null, expiresAt: { gt: new Date() } } });
  if (!record) throw new CommerceError("validation_failed", "Token inválido ou expirado");
  await prisma.$transaction([
    prisma.lojaClienteToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
    prisma.lojaCliente.update({ where: { id: record.lojaClienteId }, data: { status: "ATIVO", emailVerificadoEm: new Date() } }),
  ]);
}

export async function loginStoreCustomer(slug: string, emailValue: string, password: string, context: { userAgent?: string; ip?: string }) {
  const config = await resolveStore(slug);
  if (!config.permitirLogin) throw new CommerceError("validation_failed", "Login não habilitado nesta loja");
  const email = emailValue.trim().toLowerCase();
  const customer = await prisma.lojaCliente.findUnique({ where: { contaId_emailNormalizado: { contaId: config.contaId, emailNormalizado: email } } });
  if (!customer || !(await verifyPassword(password, customer.senhaHash))) throw new CommerceError("unauthorized", "E-mail ou senha inválidos");
  if (customer.status !== "ATIVO") throw new CommerceError("unauthorized", "Verifique seu e-mail antes de entrar");
  return { customer: { id: customer.id, name: customer.nome, email: customer.email }, ...(await createSession(customer, context)) };
}

export async function refreshStoreCustomer(refreshToken: string) {
  const session = await prisma.lojaClienteSessao.findUnique({ where: { refreshTokenHash: tokenHash(refreshToken) }, include: { Cliente: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.Cliente.status !== "ATIVO") throw new CommerceError("unauthorized", "Sessão inválida ou expirada");
  await prisma.lojaClienteSessao.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  return createSession(session.Cliente, { userAgent: session.userAgent ?? undefined, ip: session.ip ?? undefined });
}

export async function logoutStoreCustomer(refreshToken: string) {
  await prisma.lojaClienteSessao.updateMany({ where: { refreshTokenHash: tokenHash(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function requestStorePasswordReset(slug: string, emailValue: string) {
  const config = await resolveStore(slug);
  const email = emailValue.trim().toLowerCase();
  const customer = await prisma.lojaCliente.findUnique({ where: { contaId_emailNormalizado: { contaId: config.contaId, emailNormalizado: email } } });
  if (!customer) return;
  const token = await issueCustomerToken(customer, "REDEFINICAO_SENHA");
  await enqueueCustomerEmail(email, "Redefina sua senha", `${env.BASE_URL_FRONTEND}/lojas/${slug}/redefinir-senha?token=${token}`);
}

export async function resetStorePassword(slug: string, token: string, password: string) {
  const config = await resolveStore(slug);
  const record = await prisma.lojaClienteToken.findFirst({ where: { contaId: config.contaId, tipo: "REDEFINICAO_SENHA", tokenHash: tokenHash(token), consumedAt: null, expiresAt: { gt: new Date() } } });
  if (!record) throw new CommerceError("validation_failed", "Token inválido ou expirado");
  const senhaHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.lojaClienteToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
    prisma.lojaCliente.update({ where: { id: record.lojaClienteId }, data: { senhaHash } }),
    prisma.lojaClienteSessao.updateMany({ where: { contaId: config.contaId, lojaClienteId: record.lojaClienteId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}

export async function decodeStoreAccessToken(token: string) {
  try {
    const payload = jwt.verify(token, customerSecret(), { audience: "loja-cliente" }) as any;
    const session = await prisma.lojaClienteSessao.findFirst({ where: { id: Number(payload.sessionId), contaId: Number(payload.contaId), lojaClienteId: Number(payload.sub), revokedAt: null, expiresAt: { gt: new Date() } } });
    if (!session) return null;
    return { id: Number(payload.sub), contaId: Number(payload.contaId), email: String(payload.email) };
  } catch { return null; }
}
