import { z } from "zod";
import { MAIN_VISIBLE_MENU_KEYS, KNOWN_SUBMENU_KEYS } from "../services/contas/menuVisibilityPolicy";

export const fonts = ["Inter", "Roboto", "Poppins", "Montserrat", "Sora"] as const;
export const questionKeys = ["vendeProdutos", "prestaServicos", "usaAgendamento", "gerenciaQuadras", "atuaOurivesaria", "operaRestauranteDelivery", "usaCombos", "possuiContratosRecorrentes", "vendeOnline", "usaAtendimentoWhatsapp", "usaNotificacoesWhatsapp", "emiteNotas"] as const;
export const respostasSchema = z.object({
  vendeProdutos: z.boolean(), prestaServicos: z.boolean(), usaAgendamento: z.boolean(),
  gerenciaQuadras: z.boolean(), atuaOurivesaria: z.boolean(), operaRestauranteDelivery: z.boolean(),
  usaCombos: z.boolean(), possuiContratosRecorrentes: z.boolean(), vendeOnline: z.boolean(),
  usaAtendimentoWhatsapp: z.boolean(), usaNotificacoesWhatsapp: z.boolean(), emiteNotas: z.boolean(),
}).strict();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const onboardingThemeSchema = z.object({
  primariaLight: color, primariaDark: color, sidebarLight: color, sidebarDark: color,
  fundoLight: color, fundoDark: color,
  radius: z.enum(["0rem", "0.375rem", "0.5rem", "0.75rem", "1rem", "1.5rem"]),
  fonte: z.enum(fonts), tamanhoFonte: z.enum(["100%", "112.5%", "125%", "137.5%"]),
  bordaBadgeCell: z.boolean(),
}).strict();
const modules = z.array(z.string().min(1).max(80)).max(30).transform(v => [...new Set(v)]);
const menus = z.array(z.enum([...MAIN_VISIBLE_MENU_KEYS, ...KNOWN_SUBMENU_KEYS])).max(120).transform(v => [...new Set(v)]);
export const onboardingPreviewSchema = z.object({
  version: z.literal(1), respostas: respostasSchema,
  modulosSelecionados: modules.optional(), menusSelecionados: menus.optional(),
  catalogVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export const onboardingCadastroSchema = onboardingPreviewSchema.extend({
  modulosSelecionados: modules, menusSelecionados: menus, temaPersonalizado: onboardingThemeSchema,
  catalogVersion: z.string().regex(/^[a-f0-9]{64}$/),
});
export type OnboardingInput = z.infer<typeof onboardingPreviewSchema>;
