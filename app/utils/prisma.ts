// Garante que o .env esteja carregado antes de lermos DATABASE_URL aqui
// (idempotente: se já foi carregado em outro ponto, não faz nada).
import 'dotenv/config';
import { PrismaClient } from '../../generated/client';

// Limita o pool de conexões POR PROCESSO.
//
// Sem `connection_limit`, o Prisma usa o padrão (num_cpus * 2 + 1, ~17). Como
// rodamos vários processos (API + workers de email/notificação/whatsapp/cron) e,
// em dev, o `tsx watch` reinicia o processo a cada alteração (deixando conexões
// penduradas até o MySQL liberar), o total estoura o `max_connections` do banco
// -> "Too many connections" (P2037 / HY000 1040).
//
// Ajuste fino por ambiente com PRISMA_CONNECTION_LIMIT / PRISMA_POOL_TIMEOUT.
function resolveDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  // Respeita um connection_limit já configurado na própria URL.
  if (/[?&]connection_limit=/i.test(url)) return url;

  const limit = process.env.PRISMA_CONNECTION_LIMIT || '5';
  const poolTimeout = process.env.PRISMA_POOL_TIMEOUT || '20';
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connection_limit=${limit}&pool_timeout=${poolTimeout}`;
}

// Reaproveita a mesma instância entre hot-reloads do `tsx watch` em dev, evitando
// criar um novo PrismaClient (e um novo pool) a cada recarga.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const datasourceUrl = resolveDatabaseUrl();

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(datasourceUrl ? { datasourceUrl } : undefined);

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export {
    prisma
}
