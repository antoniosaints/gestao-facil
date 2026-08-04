export function slugifyRestaurantName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "restaurante";
}

export function buildInitialRestaurantConfig(conta: {
  id: number;
  nome: string;
  nomeFantasia?: string | null;
}) {
  const nomePublico = (conta.nomeFantasia || conta.nome || "Restaurante").trim();
  return {
    slug: `${slugifyRestaurantName(nomePublico)}-${conta.id}`,
    nomePublico,
    ativo: false,
    pedidosQrDireto: false,
    modoFrete: "FIXO" as const,
    taxaFixa: 0,
    freteGratisAcima: null,
    taxaContingencia: null,
    pedidoMinimo: 0,
    retiradaAtiva: true,
    deliveryAtivo: true,
    pagamentoOnlineAtivo: false,
    pagamentoNaEntregaAtivo: true,
  };
}
