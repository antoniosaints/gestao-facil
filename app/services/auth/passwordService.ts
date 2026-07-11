import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 10;

// Prefixo de um hash bcrypt: $2a$/$2b$/$2y$ seguido do custo. Senhas em texto puro
// (legado) não têm esse formato, então conseguimos distinguir hash de texto puro.
const BCRYPT_PREFIX = /^\$2[aby]\$\d{2}\$/;

export function isPasswordHashed(value?: string | null): boolean {
  return typeof value === "string" && BCRYPT_PREFIX.test(value);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

// Verifica a senha aceitando tanto hash bcrypt quanto texto puro (contas ainda não
// migradas). Retorna true quando a senha confere em qualquer um dos formatos.
export async function verifyPassword(
  plain: string,
  stored?: string | null
): Promise<boolean> {
  if (!stored || typeof plain !== "string" || plain.length === 0) return false;

  if (isPasswordHashed(stored)) {
    try {
      return await bcrypt.compare(plain, stored);
    } catch {
      return false;
    }
  }

  // Legado: comparação direta em texto puro.
  return plain === stored;
}

// Normaliza o valor de senha antes de gravar: se já vier um hash (ex.: formulário de
// edição que devolve a senha carregada), mantém; caso contrário, gera o hash.
export async function hashPasswordIfNeeded(value: string): Promise<string> {
  return isPasswordHashed(value) ? value : hashPassword(value);
}
