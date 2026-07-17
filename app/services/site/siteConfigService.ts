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
    badge: "7 dias grátis · sem cartão de crédito",
    title: "O sistema completo para gerir seu negócio",
    highlight: "gerir seu negócio",
    subtitle:
      "Vendas, PDV, estoque, financeiro e ordens de serviço em uma única plataforma. Comece grátis por 7 dias e, depois, apenas R$ 70/mês.",
    monthlyPrice: 70,
    trialDays: 7,
    imageUrl: "/imgs/dashboard.png",
    imageAlt: "Dashboard do Gestão Fácil",
    stats: [
      { value: "5 min", label: "para configurar" },
      { value: "100%", label: "online" },
      { value: "7 dias", label: "grátis" },
      { value: "R$ 70", label: "por mês" },
    ],
  },
  features: [
    { title: "Vendas e PDV", description: "Frente de caixa rápida com leitor de código de barras, cupom e impressão térmica.", icon: "ScanLine" },
    { title: "Controle de estoque", description: "Entradas e saídas em tempo real, alertas de estoque mínimo e histórico.", icon: "Box" },
    { title: "Financeiro completo", description: "Fluxo de caixa, contas a pagar e receber, categorias e relatórios gerenciais.", icon: "Wallet" },
    { title: "Recorrências operacionais", description: "Controle assinaturas a pagar, links úteis, ciclos recorrentes e lançamentos vinculados.", icon: "Repeat" },
    { title: "Clientes", description: "Cadastro completo, histórico de compras e cadastro público por link.", icon: "UsersRound" },
    { title: "Relatórios e dashboards", description: "Vendas, ticket médio, produtos mais vendidos, estoque e saldo mensal em painéis claros.", icon: "FileBarChart" },
    { title: "Ordens de serviço", description: "Abertura, acompanhamento e faturamento de OS com garantia e assinatura do cliente.", icon: "Wrench" },
    { title: "Catálogo público", description: "Compartilhe produtos por link público. Se precisar vender online, ative a Loja Virtual.", icon: "Store" },
  ],
  apps: [
    { title: "CORE IA", category: "Chat inteligente", description: "Chat inteligente que auxilia na produtividade do time.", price: 9.9, icon: "Bot" },
    { title: "WhatsApp", category: "Notificações", description: "Integração com WhatsApp para comunicação e notificações.", price: 19.9, icon: "MessageCircle" },
    { title: "Atendimento", category: "Central de conversas", description: "Chat via WhatsApp com conversas, filas, atendentes e vínculo com clientes.", price: 29.9, icon: "Headset" },
    { title: "Loja Virtual", category: "Vendas online", description: "Vitrine online personalizável com cores, banners, login e cadastro de clientes.", price: 39.9, icon: "Store" },
    { title: "Contratos", category: "Recorrência", description: "Gestão de contratos recorrentes, ciclos, comodatos e cobranças.", price: 5, icon: "Repeat" },
    { title: "Mercado Pago", category: "Gateway gratuito", description: "Configure as credenciais operacionais do Mercado Pago da conta.", price: 0, icon: "CreditCard" },
  ],
  benefits: [
    "Dashboard com indicadores em tempo real",
    "Acesse do computador, tablet ou celular",
    "Exporte relatórios em PDF",
    "Backup automático diário",
  ],
  adaptBenefits: [
    "Sem custo de implementação",
    "Suporte técnico especializado",
    "Ative apps conforme sua necessidade",
    "Loja, atendimento, IA e gateways no mesmo ecossistema",
  ],
  included: [
    "Vendas e PDV ilimitados",
    "Financeiro completo",
    "Controle de estoque",
    "Ordens de serviço",
    "Clientes ilimitados",
    "Relatórios e dashboards",
    "Cupom e impressão térmica",
    "Catálogo público por link",
    "Suporte incluso",
  ],
  faqs: [
    { q: "Preciso de cartão de crédito para testar?", a: "Não. O teste de 7 dias é totalmente gratuito e não pedimos cartão de crédito para começar." },
    { q: "O que acontece depois dos 7 dias grátis?", a: "A mensalidade de R$ 70 passa a valer pelo sistema completo. Você pode cancelar quando quiser, sem multa ou fidelidade." },
    { q: "Como funcionam os apps adicionais?", a: "São módulos opcionais, como CORE IA, WhatsApp, Atendimento, Loja Virtual e Contratos. Você ativa e desativa direto na App Store; apps pagos entram na mensalidade de forma proporcional e apps de valor zerado aparecem como gratuitos." },
    { q: "Posso usar em mais de um dispositivo?", a: "Sim. O Gestão Fácil é 100% online e você acessa do computador, tablet ou celular, de onde estiver." },
    { q: "Meus dados ficam seguros?", a: "Sim. Fazemos backup automático diário e seus dados ficam protegidos e disponíveis sempre que você precisar." },
    { q: "Tem fidelidade ou taxa de cancelamento?", a: "Não. Você paga mês a mês e pode cancelar a qualquer momento, sem taxas escondidas." },
  ],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeLegacyEncoding(value: string): string {
  if (!/[ÃÂ]/.test(value)) return value;

  let current = value;
  for (let index = 0; index < 3 && /[ÃÂ]/.test(current); index += 1) {
    const decoded = Buffer.from(current, "latin1").toString("utf8");
    if (!decoded || decoded === current) break;
    current = decoded;
  }

  return current;
}

function normalizeConfigEncoding<T>(value: T): T {
  if (typeof value === "string") {
    return normalizeLegacyEncoding(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeConfigEncoding(item)) as T;
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeConfigEncoding(item)]),
    ) as T;
  }

  return value;
}

function mergeSiteConfig(config?: Partial<SitePublicConfig> | null): SitePublicConfig {
  if (!config) return normalizeConfigEncoding(DEFAULT_SITE_PUBLIC_CONFIG);

  const normalizedConfig = normalizeConfigEncoding(config);

  return normalizeConfigEncoding({
    ...DEFAULT_SITE_PUBLIC_CONFIG,
    ...normalizedConfig,
    hero: {
      ...DEFAULT_SITE_PUBLIC_CONFIG.hero,
      ...(isPlainObject(normalizedConfig.hero) ? normalizedConfig.hero : {}),
    },
    features: Array.isArray(normalizedConfig.features) ? normalizedConfig.features : DEFAULT_SITE_PUBLIC_CONFIG.features,
    apps: Array.isArray(normalizedConfig.apps) ? normalizedConfig.apps : DEFAULT_SITE_PUBLIC_CONFIG.apps,
    benefits: Array.isArray(normalizedConfig.benefits) ? normalizedConfig.benefits : DEFAULT_SITE_PUBLIC_CONFIG.benefits,
    adaptBenefits: Array.isArray(normalizedConfig.adaptBenefits) ? normalizedConfig.adaptBenefits : DEFAULT_SITE_PUBLIC_CONFIG.adaptBenefits,
    included: Array.isArray(normalizedConfig.included) ? normalizedConfig.included : DEFAULT_SITE_PUBLIC_CONFIG.included,
    faqs: Array.isArray(normalizedConfig.faqs) ? normalizedConfig.faqs : DEFAULT_SITE_PUBLIC_CONFIG.faqs,
  });
}

function getSiteConfigFromTheme(theme: unknown): Partial<SitePublicConfig> | null {
  if (!isPlainObject(theme)) return null;
  const config = theme[SITE_PUBLIC_CONFIG_KEY];
  return isPlainObject(config) ? (config as Partial<SitePublicConfig>) : null;
}

export async function getPlatformSiteConfig(preferredContaId?: number): Promise<SitePublicConfig> {
  if (preferredContaId) {
    const preferredParams = await prisma.parametrosConta.findUnique({
      where: { contaId: preferredContaId },
      select: { temaPersonalizado: true },
    });
    const preferredConfig = getSiteConfigFromTheme(preferredParams?.temaPersonalizado);
    if (preferredConfig) return mergeSiteConfig(preferredConfig);
  }

  const params = await prisma.parametrosConta.findMany({
    where: {
      Contas: {
        Usuarios: {
          some: { superAdmin: true },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    select: { temaPersonalizado: true },
    take: 50,
  });

  const configHolder = params.find((param) => getSiteConfigFromTheme(param.temaPersonalizado));
  return mergeSiteConfig(getSiteConfigFromTheme(configHolder?.temaPersonalizado));
}

/**
 * O JSON `temaPersonalizado` guarda duas coisas sem relação: o tema do ERP (cores,
 * fonte, radius) e a configuração do site público (chave `sitePublico`). Quem grava
 * o tema precisa passar por aqui, senão sobrescreve o JSON inteiro e apaga o site —
 * era o que fazia as configurações do site voltarem sozinhas para o padrão assim que
 * alguém salvasse a Aparência.
 *
 * Retorna `undefined` quando não há nada a atualizar, o que o Prisma interpreta como
 * "não toque neste campo".
 */
export async function mergeTemaPersonalizado(
  contaId: number,
  incoming: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown> | null | undefined> {
  if (incoming === undefined) return undefined;

  const current = await prisma.parametrosConta.findUnique({
    where: { contaId },
    select: { temaPersonalizado: true },
  });

  const currentTheme = isPlainObject(current?.temaPersonalizado)
    ? (current.temaPersonalizado as Record<string, unknown>)
    : {};

  const siteConfig = currentTheme[SITE_PUBLIC_CONFIG_KEY];
  const preservado = siteConfig !== undefined ? { [SITE_PUBLIC_CONFIG_KEY]: siteConfig } : {};

  // Limpar o tema não pode levar o site junto.
  if (incoming === null) {
    return siteConfig !== undefined ? preservado : null;
  }

  return { ...currentTheme, ...incoming };
}

export async function savePlatformSiteConfig(contaId: number, config: SitePublicConfig): Promise<SitePublicConfig> {
  const current = await prisma.parametrosConta.findUnique({
    where: { contaId },
    select: { temaPersonalizado: true },
  });

  const currentTheme = isPlainObject(current?.temaPersonalizado)
    ? (current.temaPersonalizado as Record<string, unknown>)
    : {};

  const normalizedConfig = mergeSiteConfig(config);

  const nextTheme = {
    ...currentTheme,
    [SITE_PUBLIC_CONFIG_KEY]: normalizedConfig,
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

  return normalizedConfig;
}
