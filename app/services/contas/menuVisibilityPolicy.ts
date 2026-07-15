import type { PermissaoUsuario } from "../../../generated/client";

export const MAIN_VISIBLE_MENU_KEYS = [
  "dashboard",
  "metas",
  "vendas",
  "comandas",
  "financeiro",
  "produtos",
  "servicos",
  "clientes",
  "assinaturas",
  "core-ia",
  "whatsapp",
  "atendimento",
  // A Loja Virtual passou a ser configurável como os demais menus. Contas anteriores a essa
  // mudança recebem a key por migration; sem isso a whitelist esconderia a loja delas.
  "loja-virtual",
  "usuarios",
  "configuracoes",
  "changelog",
  "perfil",
  "loja",
] as const;

export const ROOT_ALWAYS_VISIBLE_MENU_KEYS = ["configuracoes"] as const;

// Submenus que podem ser ocultados individualmente. Keys no formato "pai:filho" (com ":"),
// o que as diferencia das keys de menu de topo (sem ":"). No array `menusVisiveis`, keys de
// topo funcionam como whitelist (presente = visível) e keys de submenu como blacklist
// (presente = OCULTO). Deve espelhar MENU_SUBMENU_VISIBILITY_OPTIONS do frontend.
export const KNOWN_SUBMENU_KEYS = [
  "vendas:painel",
  "vendas:lista",
  "vendas:caixas",
  "financeiro:painel",
  "financeiro:lancamentos",
  "financeiro:acompanhamento",
  "financeiro:contas-a-receber",
  "financeiro:contas-a-pagar",
  "financeiro:assinaturas-a-pagar",
  "financeiro:cobrancas",
  "produtos:painel",
  "produtos:lista",
  "produtos:reposicao",
  "produtos:movimentacoes",
  "servicos:painel",
  "servicos:os",
  "servicos:lista",
  "assinaturas:painel",
  "assinaturas:lista",
  "assinaturas:planos",
  "assinaturas:cobrancas",
  "assinaturas:comodatos",
  "atendimento:painel",
  "atendimento:chat",
  "atendimento:agentes",
  "atendimento:relatorios",
] as const;

const knownMenuKeys = new Set<string>(MAIN_VISIBLE_MENU_KEYS);
const knownSubmenuKeys = new Set<string>(KNOWN_SUBMENU_KEYS);

export function canManageMenuVisibility(permissao?: PermissaoUsuario | string | null) {
  return permissao === "root";
}

export function normalizeVisibleMenuKeys(keys?: string[] | null): string[] | null {
  if (!Array.isArray(keys)) return null;

  const normalized = keys.filter(
    (key, index) =>
      (knownMenuKeys.has(key) || knownSubmenuKeys.has(key)) &&
      keys.indexOf(key) === index
  );

  for (const key of ROOT_ALWAYS_VISIBLE_MENU_KEYS) {
    if (!normalized.includes(key)) normalized.push(key);
  }

  return normalized;
}
