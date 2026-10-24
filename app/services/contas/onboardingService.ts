import { createHash } from "node:crypto";
import type { Prisma } from "../../../generated/client";
import { fonts, questionKeys, type OnboardingInput } from "../../schemas/onboarding";

export const baseMenuKeys = ["dashboard", "financeiro", "clientes", "configuracoes", "perfil", "loja", "usuarios", "changelog", "metas"];
export const moduleMenuKeys: Record<string, string | null> = {
  "core-ia": "core-ia", whatsapp: "whatsapp", atendimento: "atendimento", "loja-virtual": "loja-virtual",
  combos: "produtos:combos", assinaturas: "assinaturas", servicos: "servicos", ourives: "ourive", arena: "arena",
  reservas: "reservas", "restaurante-delivery": "restaurante", "notas-fiscais": "notas-fiscais", "mercado-pago": null, abacatepay: null,
};
export type CatalogModule = { id: number; codigo: string; nome: string; preco: { toString(): string } | number; status: boolean };
export function publicModules(catalog: CatalogModule[]) {
  return catalog.filter(m => Object.prototype.hasOwnProperty.call(moduleMenuKeys, m.codigo)).map(m => ({
    codigo: m.codigo, nome: m.nome, menuKey: moduleMenuKeys[m.codigo], precoMensal: Number(m.preco), status: m.status,
    ativacaoNoCadastro: m.status && Number(m.preco) === 0,
  }));
}
export function catalogVersion(catalog: CatalogModule[]) {
  return createHash("sha256").update(JSON.stringify(publicModules(catalog).sort((a,b) => a.codigo.localeCompare(b.codigo)))).digest("hex");
}
const rules = {
  prestaServicos: "servicos", usaAgendamento: "reservas", gerenciaQuadras: "arena", atuaOurivesaria: "ourives",
  operaRestauranteDelivery: "restaurante-delivery", usaCombos: "combos", possuiContratosRecorrentes: "assinaturas",
  vendeOnline: "loja-virtual", usaAtendimentoWhatsapp: "atendimento", usaNotificacoesWhatsapp: "whatsapp", emiteNotas: "notas-fiscais",
} as const;
export class OnboardingCatalogChanged extends Error {
  readonly code = "ONBOARDING_CATALOG_CHANGED";
  constructor() { super("O catálogo mudou ou a seleção está indisponível. Revise os módulos antes de continuar."); }
}
export function previewOnboarding(input: OnboardingInput, catalog: CatalogModule[]) {
  const suggestions: string[] = Object.entries(rules).filter(([key]) => input.respostas[key as keyof typeof rules]).map(([,code]) => code);
  const selected = input.modulosSelecionados ?? suggestions.filter(code => catalog.some(m => m.codigo === code && m.status));
  if (input.catalogVersion && input.catalogVersion !== catalogVersion(catalog)) throw new OnboardingCatalogChanged();
  if (selected.some(code => !publicModules(catalog).some(m => m.codigo === code && m.status))) throw new OnboardingCatalogChanged();
  const menusSugeridos = [...baseMenuKeys];
  if (input.respostas.vendeProdutos || input.respostas.usaCombos) menusSugeridos.push("produtos", "vendas");
  for (const code of suggestions) {
    const key = moduleMenuKeys[code];
    if (key && !key.includes(":")) menusSugeridos.push(key);
  }
  const menusEfetivos = new Set([...(input.menusSelecionados ?? menusSugeridos), ...baseMenuKeys]);
  // Submenu keys are a blacklist, unlike top-level keys. Never add a selected combo as a hidden submenu.
  if (selected.includes("combos")) { menusEfetivos.add("produtos"); menusEfetivos.delete("produtos:combos"); }
  else menusEfetivos.add("produtos:combos");
  const modulos = publicModules(catalog).map(m => ({
    codigo: m.codigo, motivo: suggestions.includes(m.codigo) ? "Recomendado pelas respostas do empreendimento" : "Seleção opcional",
    precoMensal: m.precoMensal, selecionado: selected.includes(m.codigo),
    acao: !selected.includes(m.codigo) ? "NAO_SELECIONADO" as const : m.ativacaoNoCadastro ? "ATIVAR_GRATUITO" as const : "RECOMENDAR_CONTRATACAO" as const,
  }));
  return { version: 1 as const, catalogVersion: catalogVersion(catalog), menusSugeridos: [...new Set(menusSugeridos)], menusEfetivos: [...menusEfetivos], modulos,
    avisos: ["Apps pagos exigem contratação posterior na App Store. Nenhuma cobrança é gerada no cadastro.", ...(selected.some(c => ["whatsapp", "atendimento", "mercado-pago", "abacatepay"].includes(c)) ? ["As integrações precisam ser configuradas após o cadastro."] : [])] };
}
export async function readOnboardingCatalog(db: Pick<Prisma.TransactionClient, "modulosAdicionais">) {
  return db.modulosAdicionais.findMany({ select: { id: true, codigo: true, nome: true, preco: true, status: true }, orderBy: { codigo: "asc" } });
}
export async function activateFreeOnboardingModules(tx: Pick<Prisma.TransactionClient, "moduloOnConta">, contaId: number, vencimento: Date, preview: ReturnType<typeof previewOnboarding>, catalog: CatalogModule[]) {
  const free = preview.modulos.filter(m => m.acao === "ATIVAR_GRATUITO");
  for (const selected of free) {
    const module = catalog.find(m => m.codigo === selected.codigo && m.status && Number(m.preco) === 0);
    if (!module) throw new OnboardingCatalogChanged();
    await tx.moduloOnConta.create({ data: { contaId, moduloId: module.id, vencimento, valorAdicional: 0, status: "ATIVO" } });
  }
}
export function onboardingConfig(catalog: CatalogModule[]) {
  const tema = { primariaLight: "#2563EB", primariaDark: "#1D4ED8", sidebarLight: "#1D4ED8", sidebarDark: "#172554", fundoLight: "#F8FAFC", fundoDark: "#020617", radius: "0.5rem", fonte: "Inter", tamanhoFonte: "100%", bordaBadgeCell: true };
  const labels = ["Vende produtos?", "Presta serviços ou usa ordens de serviço?", "Usa agendamento?", "Gerencia quadras?", "Atua com ourivesaria?", "Opera restaurante ou delivery?", "Usa combos?", "Possui contratos recorrentes?", "Vende online?", "Usa atendimento pelo WhatsApp?", "Envia notificações pelo WhatsApp?", "Emite notas fiscais?"];
  return { version: 1, catalogVersion: catalogVersion(catalog), questions: questionKeys.map((key,i) => ({ key, label: labels[i] })), baseMenuKeys, modules: publicModules(catalog), fonts,
    themePresets: [{ id: "azul", nome: "Azul", tema }, { id: "verde", nome: "Verde", tema: { ...tema, primariaLight: "#059669", primariaDark: "#10B981", sidebarLight: "#047857", sidebarDark: "#022C22" } }, { id: "violeta", nome: "Violeta", tema: { ...tema, primariaLight: "#7C3AED", primariaDark: "#A78BFA", sidebarLight: "#6D28D9", sidebarDark: "#2E1065" } }] };
}
