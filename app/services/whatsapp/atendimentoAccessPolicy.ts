export type AtendimentoAccessReason = "app-inativo" | "menu-oculto";

export type AtendimentoAccess =
  | { enabled: true; reason: null }
  | { enabled: false; reason: AtendimentoAccessReason };

// `null` mantém o comportamento das contas sem configuração de menus: todos os
// menus disponíveis seguem visíveis. Uma whitelist explícita precisa conter o
// menu raiz, pois submenus não tornam o Atendimento acessível isoladamente.
export function resolveAtendimentoAccess(moduleActive: boolean, menusVisiveis: unknown): AtendimentoAccess {
  if (!moduleActive) return { enabled: false, reason: "app-inativo" };
  if (!Array.isArray(menusVisiveis) || menusVisiveis.includes("atendimento")) {
    return { enabled: true, reason: null };
  }
  return { enabled: false, reason: "menu-oculto" };
}
