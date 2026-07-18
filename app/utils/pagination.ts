// Helpers de paginação/ordenação para os datatables.
//
// Objetivos de segurança/performance:
// - Teto de pageSize: sem limite, um cliente pode pedir `pageSize` gigante e
//   forçar o banco a materializar milhares de linhas (DoS / pressão de memória).
// - Ordenação segura: `sortBy`/`order` vêm da query string. Sem sanitização, um
//   `order` inesperado (objeto/array) ou uma coluna arbitrária cai direto no
//   `orderBy` do Prisma. Aqui validamos a direção e o formato da coluna, com
//   whitelist opcional por endpoint.

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

export function clampPageSize(
  value: unknown,
  def = DEFAULT_PAGE_SIZE,
  max = MAX_PAGE_SIZE,
): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

export function parsePage(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

const ORDER_VALUES = new Set(["asc", "desc"]);
// Identificador de coluna simples: bloqueia arrays/objetos da query string e
// travessia de relação ("a.b"). Prisma ainda rejeita nomes de coluna inexistentes.
const COLUMN_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function sanitizeOrder(order: unknown, fallback: "asc" | "desc" = "asc"): "asc" | "desc" {
  if (typeof order === "string" && ORDER_VALUES.has(order.toLowerCase())) {
    return order.toLowerCase() as "asc" | "desc";
  }
  return fallback;
}

/**
 * Devolve um objeto `orderBy` seguro para o Prisma. Se `allow` for informado, a
 * coluna precisa estar na lista; caso contrário exige apenas um identificador
 * simples. Em qualquer entrada inválida, usa `fallback` (padrão: "id").
 */
export function sanitizeSort(
  sortBy: unknown,
  order: unknown,
  opts: { allow?: readonly string[]; fallback?: string } = {},
): Record<string, "asc" | "desc"> {
  const fallback = opts.fallback ?? "id";
  const dir = sanitizeOrder(order);
  let column =
    typeof sortBy === "string" && COLUMN_IDENTIFIER.test(sortBy) ? sortBy : fallback;
  if (opts.allow && !opts.allow.includes(column)) column = fallback;
  return { [column]: dir };
}
