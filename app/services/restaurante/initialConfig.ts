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
    aceitarPedidosOnline: true,
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
    localizacaoJson: null,
    whatsappNotificacoesJson: {
      PEDIDO_FEITO: { ativo: false, mensagem: "Pedido nº {idPedido}\n\nItens:\n{itens}\n\n{pagamento}\n\n{entrega}\n🏠 {endereco}\n\nTotal: {total}\n\nObrigado pela preferência, se precisar de algo é só chamar! 😉" },
      EM_PREPARO: { ativo: false, mensagem: "Olá, {cliente}! Seu pedido {pedido} já está em preparo." },
      SAIU_ENTREGA: { ativo: false, mensagem: "Olá, {cliente}! Seu pedido {pedido} saiu para entrega." },
      PRONTO: { ativo: false, mensagem: "Olá, {cliente}! Seu pedido {pedido} está pronto." },
      ENTREGUE: { ativo: false, mensagem: "Olá, {cliente}! Seu pedido {pedido} foi entregue. Bom apetite!" },
      POS_PEDIDO: { ativo: false, mensagem: "Olá, {cliente}! Obrigado por pedir na {empresa}. Esperamos que tenha gostado!" },
    },
    horariosJson: [
      { dia: "SEGUNDA", ativo: true, abertura: "08:00", fechamento: "18:00" },
      { dia: "TERCA", ativo: true, abertura: "08:00", fechamento: "18:00" },
      { dia: "QUARTA", ativo: true, abertura: "08:00", fechamento: "18:00" },
      { dia: "QUINTA", ativo: true, abertura: "08:00", fechamento: "18:00" },
      { dia: "SEXTA", ativo: true, abertura: "08:00", fechamento: "18:00" },
      { dia: "SABADO", ativo: true, abertura: "08:00", fechamento: "18:00" },
      { dia: "DOMINGO", ativo: false, abertura: "08:00", fechamento: "18:00" },
    ],
  };
}
