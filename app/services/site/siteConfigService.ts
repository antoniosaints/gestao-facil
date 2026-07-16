import { prisma } from "../../utils/prisma";

export const SITE_PUBLIC_CONFIG_KEY = "sitePublico";

export type SitePublicConfig = {
  hero: {
    badge: string;
    title: string;
    highlight: string;
    subtitle: string;
    monthlyPrice: number;
    trialDays: number;
    imageUrl: string;
    imageAlt: string;
    stats: { value: string; label: string }[];
  };
  features: { title: string; description: string; icon: string }[];
  apps: { title: string; category: string; description: string; price: number; icon: string }[];
  benefits: string[];
  adaptBenefits: string[];
  included: string[];
  faqs: { q: string; a: string }[];
};

export const DEFAULT_SITE_PUBLIC_CONFIG: SitePublicConfig = {
  hero: {
    badge: "7 dias grÃ¡tis Â· sem cartÃ£o de crÃ©dito",
    title: "O sistema completo para gerir seu negÃ³cio",
    highlight: "gerir seu negÃ³cio",
    subtitle:
      "Vendas, PDV, estoque, financeiro e ordens de serviÃ§o em uma Ãºnica plataforma. Comece grÃ¡tis por 7 dias e, depois, apenas R$ 70/mÃªs.",
    monthlyPrice: 70,
    trialDays: 7,
    imageUrl: "/imgs/dashboard.png",
    imageAlt: "Dashboard do GestÃ£o FÃ¡cil",
    stats: [
      { value: "5 min", label: "para configurar" },
      { value: "100%", label: "online" },
      { value: "7 dias", label: "grÃ¡tis" },
      { value: "R$ 70", label: "por mÃªs" },
    ],
  },
  features: [
    { title: "Vendas e PDV", description: "Frente de caixa rÃ¡pida com leitor de cÃ³digo de barras, cupom e impressÃ£o tÃ©rmica.", icon: "ScanLine" },
    { title: "Controle de estoque", description: "Entradas e saÃ­das em tempo real, alertas de estoque mÃ­nimo e histÃ³rico.", icon: "Box" },
    { title: "Financeiro completo", description: "Fluxo de caixa, contas a pagar e receber, categorias e relatÃ³rios gerenciais.", icon: "Wallet" },
    { title: "RecorrÃªncias operacionais", description: "Controle assinaturas a pagar, links Ãºteis, ciclos recorrentes e lanÃ§amentos vinculados.", icon: "Repeat" },
    { title: "Clientes", description: "Cadastro completo, histÃ³rico de compras e cadastro pÃºblico por link.", icon: "UsersRound" },
    { title: "RelatÃ³rios e dashboards", description: "Vendas, ticket mÃ©dio, produtos mais vendidos, estoque e saldo mensal em painÃ©is claros.", icon: "FileBarChart" },
    { title: "Ordens de serviÃ§o", description: "Abertura, acompanhamento e faturamento de OS com garantia e assinatura do cliente.", icon: "Wrench" },
    { title: "CatÃ¡logo pÃºblico", description: "Compartilhe produtos por link pÃºblico. Se precisar vender online, ative a Loja Virtual.", icon: "Store" },
  ],
  apps: [
    { title: "CORE IA", category: "Chat inteligente", description: "Chat inteligente que auxilia na produtividade do time.", price: 9.9, icon: "Bot" },
    { title: "WhatsApp", category: "NotificaÃ§Ãµes", description: "IntegraÃ§Ã£o com WhatsApp para comunicaÃ§Ã£o e notificaÃ§Ãµes.", price: 19.9, icon: "MessageCircle" },
    { title: "Atendimento", category: "Central de conversas", description: "Chat via WhatsApp com conversas, filas, atendentes e vÃ­nculo com clientes.", price: 29.9, icon: "Headset" },
    { title: "Loja Virtual", category: "Vendas online", description: "Vitrine online personalizÃ¡vel com cores, banners, login e cadastro de clientes.", price: 39.9, icon: "Store" },
    { title: "Assinaturas", category: "RecorrÃªncia", description: "GestÃ£o de contratos recorrentes, ciclos, comodatos e cobranÃ§as.", price: 5, icon: "Repeat" },
    { title: "Mercado Pago", category: "Gateway gratuito", description: "Configure as credenciais operacionais do Mercado Pago da conta.", price: 0, icon: "CreditCard" },
  ],
  benefits: [
    "Dashboard com indicadores em tempo real",
    "Acesse do computador, tablet ou celular",
    "Exporte relatÃ³rios em PDF",
    "Backup automÃ¡tico diÃ¡rio",
  ],
  adaptBenefits: [
    "Sem custo de implementaÃ§Ã£o",
    "Suporte tÃ©cnico especializado",
    "Ative apps conforme sua necessidade",
    "Loja, atendimento, IA e gateways no mesmo ecossistema",
  ],
  included: [
    "Vendas e PDV ilimitados",
    "Financeiro completo",
    "Controle de estoque",
    "Ordens de serviÃ§o",
    "Clientes ilimitados",
    "RelatÃ³rios e dashboards",
    "Cupom e impressÃ£o tÃ©rmica",
    "CatÃ¡logo pÃºblico por link",
    "Suporte incluso",
  ],
  faqs: [
    { q: "Preciso de cartÃ£o de crÃ©dito para testar?", a: "NÃ£o. O teste de 7 dias Ã© totalmente gratuito e nÃ£o pedimos cartÃ£o de crÃ©dito para comeÃ§ar." },
    { q: "O que acontece depois dos 7 dias grÃ¡tis?", a: "A mensalidade de R$ 70 passa a valer pelo sistema completo. VocÃª pode cancelar quando quiser, sem multa ou fidelidade." },
    { q: "Como funcionam os apps adicionais?", a: "SÃ£o mÃ³dulos opcionais, como CORE IA, WhatsApp, Atendimento, Loja Virtual e Assinaturas. VocÃª ativa e desativa direto na App Store; apps pagos entram na mensalidade de forma proporcional e apps de valor zerado aparecem como gratuitos." },
    { q: "Posso usar em mais de um dispositivo?", a: "Sim. O GestÃ£o FÃ¡cil Ã© 100% online e vocÃª acessa do computador, tablet ou celular, de onde estiver." },
    { q: "Meus dados ficam seguros?", a: "Sim. Fazemos backup automÃ¡tico diÃ¡rio e seus dados ficam protegidos e disponÃ­veis sempre que vocÃª precisar." },
    { q: "Tem fidelidade ou taxa de cancelamento?", a: "NÃ£o. VocÃª paga mÃªs a mÃªs e pode cancelar a qualquer momento, sem taxas escondidas." },
  ],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeSiteConfig(config?: Partial<SitePublicConfig> | null): SitePublicConfig {
  if (!config) return DEFAULT_SITE_PUBLIC_CONFIG;

  return {
    ...DEFAULT_SITE_PUBLIC_CONFIG,
    ...config,
    hero: {
      ...DEFAULT_SITE_PUBLIC_CONFIG.hero,
      ...(isPlainObject(config.hero) ? config.hero : {}),
    },
    features: Array.isArray(config.features) ? config.features : DEFAULT_SITE_PUBLIC_CONFIG.features,
    apps: Array.isArray(config.apps) ? config.apps : DEFAULT_SITE_PUBLIC_CONFIG.apps,
    benefits: Array.isArray(config.benefits) ? config.benefits : DEFAULT_SITE_PUBLIC_CONFIG.benefits,
    adaptBenefits: Array.isArray(config.adaptBenefits) ? config.adaptBenefits : DEFAULT_SITE_PUBLIC_CONFIG.adaptBenefits,
    included: Array.isArray(config.included) ? config.included : DEFAULT_SITE_PUBLIC_CONFIG.included,
    faqs: Array.isArray(config.faqs) ? config.faqs : DEFAULT_SITE_PUBLIC_CONFIG.faqs,
  };
}

function getSiteConfigFromTheme(theme: unknown): Partial<SitePublicConfig> | null {
  if (!isPlainObject(theme)) return null;
  const config = theme[SITE_PUBLIC_CONFIG_KEY];
  return isPlainObject(config) ? (config as Partial<SitePublicConfig>) : null;
}

export async function getPlatformSiteConfig(): Promise<SitePublicConfig> {
  const params = await prisma.parametrosConta.findFirst({
    where: {
      Contas: {
        Usuarios: {
          some: { superAdmin: true },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    select: { temaPersonalizado: true },
  });

  return mergeSiteConfig(getSiteConfigFromTheme(params?.temaPersonalizado));
}

export async function savePlatformSiteConfig(contaId: number, config: SitePublicConfig): Promise<SitePublicConfig> {
  const current = await prisma.parametrosConta.findUnique({
    where: { contaId },
    select: { temaPersonalizado: true },
  });

  const currentTheme = isPlainObject(current?.temaPersonalizado)
    ? (current.temaPersonalizado as Record<string, unknown>)
    : {};

  const nextTheme = {
    ...currentTheme,
    [SITE_PUBLIC_CONFIG_KEY]: config,
  };

  await prisma.parametrosConta.upsert({
    where: { contaId },
    create: {
      contaId,
      temaPersonalizado: nextTheme,
    },
    update: {
      temaPersonalizado: nextTheme,
    },
  });

  return mergeSiteConfig(config);
}
