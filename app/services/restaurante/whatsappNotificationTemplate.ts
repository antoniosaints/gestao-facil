const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export type RestaurantMessageItem = {
  quantidade: unknown;
  nomeSnapshot: string;
  tamanhoSnapshot?: string | null;
  selecoesSnapshotJson?: unknown;
};

function formatFirstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "cliente";
}

function formatAddress(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const address = value as Record<string, unknown>;
  const street = [address.logradouro, address.numero ? `Nº ${address.numero}` : null]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(", ");
  const complement = typeof address.complemento === "string" && address.complemento.trim()
    ? address.complemento.trim()
    : "";
  const districtCity = [address.bairro, address.cidade]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(", ");
  return [[street, complement].filter(Boolean).join(" - "), districtCity].filter(Boolean).join(", ");
}

function formatSelections(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((selection): selection is Record<string, unknown> => Boolean(selection) && typeof selection === "object" && !Array.isArray(selection))
    .map((selection) => {
      const name = typeof selection.nome === "string" ? selection.nome.trim() : "";
      if (!name) return "";
      const type = selection.tipo === "SABOR" ? "Sabor" : selection.tipo === "COMPLEMENTO" ? "Complemento" : "";
      return type ? `   ${type}: ${name}` : `   ${name}`;
    })
    .filter(Boolean);
}

export function formatRestaurantOrderItems(items: RestaurantMessageItem[]) {
  return items.map((item) => {
    const lines = [`➡️ ${Number(item.quantidade)}x ${item.nomeSnapshot}`];
    if (item.tamanhoSnapshot?.trim()) lines.push(`   ${item.tamanhoSnapshot.trim()}`);
    lines.push(...formatSelections(item.selecoesSnapshotJson));
    return lines.join("\n");
  }).join("\n");
}

export function restaurantPaymentMethodLabel(method?: string | null) {
  const labels: Record<string, string> = {
    PIX: "📱 Pix",
    NA_ENTREGA: "💵 Pagamento na entrega",
    MESA: "🍽️ Pagamento na mesa",
  };
  return labels[method || ""] || "Pagamento a combinar";
}

export function buildRestaurantWhatsAppTemplateValues(input: {
  id: number;
  codigo: string;
  clienteNomeSnapshot?: string | null;
  empresa: string;
  total: unknown;
  frete: unknown;
  origem: string;
  enderecoSnapshotJson?: unknown;
  pagamentoMetodoSnapshot?: string | null;
  itens: RestaurantMessageItem[];
  fidelidade?: string;
  urlPagamento?: string | null;
}) {
  const delivery = input.origem === "DELIVERY";
  return {
    cliente: input.clienteNomeSnapshot || "cliente",
    primeiroNome: formatFirstName(input.clienteNomeSnapshot),
    nomeAbreviado: formatFirstName(input.clienteNomeSnapshot),
    empresa: input.empresa,
    pedido: input.codigo,
    idPedido: input.codigo,
    numeroPedido: input.codigo,
    itens: formatRestaurantOrderItems(input.itens),
    endereco: formatAddress(input.enderecoSnapshotJson),
    pagamento: restaurantPaymentMethodLabel(input.pagamentoMetodoSnapshot),
    entrega: delivery ? `🛵 Delivery (taxa de: ${currencyFormatter.format(Number(input.frete))})` : "🛍️ Retirada no local",
    frete: currencyFormatter.format(Number(input.frete)),
    total: currencyFormatter.format(Number(input.total)),
    fidelidade: input.fidelidade || "",
    urlPagamento: input.urlPagamento || "",
  };
}

export function renderRestaurantWhatsAppTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{(cliente|primeiroNome|nomeAbreviado|empresa|pedido|idPedido|numeroPedido|itens|endereco|pagamento|entrega|frete|total|fidelidade|urlPagamento)\}/g, (_match, key: string) => values[key] || "");
}
