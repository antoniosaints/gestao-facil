import type { PermissaoUsuario } from "../../../generated/client";

export const MAIN_VISIBLE_MENU_KEYS = [
  "dashboard",
  "vendas",
  "comandas",
  "financeiro",
  "produtos",
  "servicos",
  "clientes",
  "assinaturas",
  "core-ia",
  "whatsapp",
  "usuarios",
  "configuracoes",
  "changelog",
  "perfil",
  "loja",
] as const;

export const ROOT_ALWAYS_VISIBLE_MENU_KEYS = ["configuracoes"] as const;

const knownMenuKeys = new Set<string>(MAIN_VISIBLE_MENU_KEYS);

export function canManageMenuVisibility(permissao?: PermissaoUsuario | string | null) {
  return permissao === "root";
}

export function normalizeVisibleMenuKeys(keys?: string[] | null): string[] | null {
  if (!Array.isArray(keys)) return null;

  const normalized = keys.filter((key, index) => knownMenuKeys.has(key) && keys.indexOf(key) === index);

  for (const key of ROOT_ALWAYS_VISIBLE_MENU_KEYS) {
    if (!normalized.includes(key)) normalized.push(key);
  }

  return normalized;
}
