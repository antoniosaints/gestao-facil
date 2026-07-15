import { prisma } from "../../utils/prisma";

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "loja";

export const DEFAULT_THEME_CONFIG = {
  font: "Inter",
  radius: "medio",
  gridDensity: "confortavel",
  cardStyle: "elevado",
  bannerHeight: "medio",
  bannerOverlay: 25,
  bannerFocalPoint: "center",
  headerColor: "#ffffff",
  footerColor: "#ffffff",
} as const;

export async function createUniqueStoreSlug(contaId: number, storeName: string) {
  const base = slugify(storeName);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${contaId}${attempt > 1 ? `-${attempt}` : ""}`;
    const exists = await prisma.lojaVirtualConfig.findUnique({ where: { slug }, select: { id: true } });
    if (!exists) return slug;
  }
  return `loja-${contaId}-${Date.now()}`;
}

export async function ensureLojaConfig(contaId: number) {
  const existing = await prisma.lojaVirtualConfig.findUnique({ where: { contaId } });
  if (existing) return existing;

  const conta = await prisma.contas.findUniqueOrThrow({ where: { id: contaId }, select: { nome: true } });
  const slug = await createUniqueStoreSlug(contaId, conta.nome);
  return prisma.lojaVirtualConfig.create({
    data: { contaId, slug, themeConfig: DEFAULT_THEME_CONFIG },
  });
}

export function publicStoreConfig(config: Awaited<ReturnType<typeof ensureLojaConfig>>, mode: "CATALOGO" | "LOJA") {
  return {
    slug: config.slug,
    mode,
    template: config.template,
    themeVersion: config.themeVersion,
    theme: config.themeConfig ?? DEFAULT_THEME_CONFIG,
    colors: { primary: config.corPrimaria, secondary: config.corSecundaria },
    headerStyle: config.headerEstilo,
    banner: {
      desktopUrl: config.bannerUrl,
      mobileUrl: config.bannerMobileUrl,
      title: config.bannerTitulo,
      subtitle: config.bannerSubtitulo,
    },
    welcomeMessage: config.mensagemBoasVindas,
    announcement: { enabled: config.barraAvisoAtiva, text: config.barraAvisoTexto },
    capabilities: {
      showPrices: config.mostrarPrecos,
      showAvailability: config.mostrarDisponibilidade,
      hideSoldOut: config.ocultarEsgotados,
      quickAdd: mode === "LOJA" && config.quickAdd,
      whatsapp: mode === "LOJA" && config.pedidoWhatsapp,
      onlinePayment: mode === "LOJA" && config.pagamentoOnline,
      login: mode === "LOJA" && config.permitirLogin,
      register: mode === "LOJA" && config.permitirCadastro,
      guestCheckout: mode === "LOJA" && config.permitirCheckoutVisitante,
      pickup: mode === "LOJA" && config.retiradaAtiva,
      localDelivery: mode === "LOJA" && config.entregaLocalAtiva,
    },
    delivery: {
      fixedFee: Number(config.taxaEntrega),
      freeAbove: config.freteGratisAcima === null ? null : Number(config.freteGratisAcima),
    },
  };
}
