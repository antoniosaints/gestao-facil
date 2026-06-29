import Decimal from "decimal.js";

export type ComandaOperacaoStatus =
  | "ABERTA"
  | "PENDENTE"
  | "FATURADA"
  | "CANCELADA";
export type ComandaOrigemTipo = "PRODUTO" | "SERVICO" | "AVULSO";

const UID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function createComandaUid() {
  let uid = "";
  for (let index = 0; index < 6; index += 1) {
    uid += UID_ALPHABET[Math.floor(Math.random() * UID_ALPHABET.length)];
  }
  return uid;
}

export function getItemSubtotal(
  valorUnitario: Decimal.Value,
  quantidade: Decimal.Value
) {
  return new Decimal(valorUnitario)
    .mul(new Decimal(quantidade))
    .toDecimalPlaces(2);
}

export function calculateComandaTotal(
  items: Array<{
    valorUnitarioSnapshot: Decimal.Value;
    quantidade: Decimal.Value;
  }>
) {
  return items
    .reduce(
      (total, item) =>
        total.plus(getItemSubtotal(item.valorUnitarioSnapshot, item.quantidade)),
      new Decimal(0)
    )
    .toDecimalPlaces(2);
}

export function calculateComandaPaymentTotal(
  items: Array<{
    id: number;
    subtotal: Decimal.Value;
    pagamentoId?: number | null;
  }>,
  itemIds: number[]
) {
  const uniqueItemIds = Array.from(new Set(itemIds));

  if (!uniqueItemIds.length) {
    throw new Error("Selecione ao menos um item para faturar.");
  }

  const selectedItems = uniqueItemIds.map((itemId) => {
    const item = items.find((entry) => entry.id === itemId);
    if (!item) {
      throw new Error(`Item ${itemId} nao pertence a comanda.`);
    }
    if (item.pagamentoId) {
      throw new Error(`Item ${itemId} ja foi faturado.`);
    }
    return item;
  });

  return selectedItems
    .reduce((total, item) => total.plus(new Decimal(item.subtotal)), new Decimal(0))
    .toDecimalPlaces(2);
}

export function resolveComandaPaymentItemIds(itemIds?: number[] | null) {
  const uniqueItemIds = Array.from(new Set(itemIds || []));

  if (!uniqueItemIds.length) {
    throw new Error("Selecione ao menos um item para faturar.");
  }

  return uniqueItemIds;
}

export function getStatusAfterPayment(
  items: Array<{
    id: number;
    pagamentoId?: number | null;
  }>
): ComandaOperacaoStatus {
  return items.every((item) => item.pagamentoId) ? "FATURADA" : "PENDENTE";
}

export function canChangeComandaItems(status: ComandaOperacaoStatus) {
  return status === "ABERTA";
}

export function requiresStockReturnDecision(item: {
  origemTipo: ComandaOrigemTipo;
  estoqueDebitado?: boolean | null;
}) {
  return item.origemTipo === "PRODUTO" && item.estoqueDebitado === true;
}

export function getProdutoStockDeltaForQuantityEdit(
  quantidadeAtual: number,
  novaQuantidade: number
) {
  const diff = novaQuantidade - quantidadeAtual;
  if (diff > 0) return { action: "DEBITAR" as const, quantidade: diff };
  if (diff < 0) {
    return { action: "REDUZIR" as const, quantidade: Math.abs(diff) };
  }
  return { action: "NENHUM" as const, quantidade: 0 };
}

export function canFaturarComanda(levelPermission: number) {
  return levelPermission >= 2;
}

export function canFaturarComandaComFinanceiro(levelPermission: number) {
  return levelPermission >= 3;
}

export function canConfigureComandas(levelPermission: number) {
  return levelPermission >= 5;
}

export function canDeleteComanda(levelPermission: number) {
  return levelPermission >= 4;
}

export function buildComandaPdfFilename(uid: string) {
  const safeUid = uid.replace(/[^\w.-]+/g, "-");
  return `comanda-${safeUid}.pdf`;
}

export function buildComandaPosFilename(uid: string) {
  const safeUid = uid.replace(/[^\w.-]+/g, "-");
  return `comanda-${safeUid}-pos.txt`;
}

export const COMANDA_RECEIPT_80MM_WIDTH_POINTS = 226.77;

export function calculateComandaReceiptHeight(
  itemCount: number,
  paymentCount: number
) {
  return Math.max(520, 350 + itemCount * 34 + paymentCount * 18);
}

export type ComandaReceiptConta = {
  nome: string;
  documento?: string | null;
  email?: string | null;
  telefone?: string | null;
};

export type ComandaReceiptItem = {
  nomeSnapshot: string;
  origemTipo?: string | null;
  quantidade: Decimal.Value;
  valorUnitarioSnapshot: Decimal.Value;
  subtotal: Decimal.Value;
  pagamentoId?: number | null;
};

export type ComandaReceiptPagamento = {
  metodo: string;
  valor: Decimal.Value;
  dataPagamento: Date | string;
};

export type ComandaReceiptData = {
  Uid: string;
  status: string;
  clienteNomeSnapshot?: string | null;
  abertura: Date | string;
  fechamento?: Date | string | null;
  faturamento?: Date | string | null;
  cancelamento?: Date | string | null;
  total: Decimal.Value;
  observacao?: string | null;
  itens: ComandaReceiptItem[];
  pagamentos: ComandaReceiptPagamento[];
};

export function formatComandaReceiptCurrency(value: Decimal.Value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(new Decimal(value).toNumber());
}

export function formatComandaReceiptDateTime(value?: Date | string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function normalizePosText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "");
}

function posLine(text = "", size = 40) {
  return normalizePosText(text).padEnd(size, " ").substring(0, size);
}

function posCenter(text = "", size = 40) {
  const clean = normalizePosText(text).substring(0, size);
  const left = Math.max(0, Math.floor((size - clean.length) / 2));
  return `${" ".repeat(left)}${clean}`.padEnd(size, " ").substring(0, size);
}

function posPair(left: string, right: string, size = 40) {
  const cleanLeft = normalizePosText(left);
  const cleanRight = normalizePosText(right);
  const availableLeft = Math.max(0, size - cleanRight.length - 1);
  return `${cleanLeft.substring(0, availableLeft).padEnd(availableLeft)} ${cleanRight}`
    .substring(0, size)
    .padEnd(size);
}

export function buildComandaPosReceipt(
  conta: ComandaReceiptConta,
  comanda: ComandaReceiptData
) {
  const width = 40;
  const separator = "-".repeat(width);
  const totalPago = comanda.pagamentos
    .reduce((total, pagamento) => total.plus(pagamento.valor), new Decimal(0))
    .toDecimalPlaces(2);
  const aberto = new Decimal(comanda.total).minus(totalPago).toDecimalPlaces(2);

  let cupom = "";

  cupom += "\x1B\x40";
  cupom += "\x1B\x61\x01";
  cupom += `${posCenter(conta.nome, width)}\n`;
  cupom += `${posCenter(conta.documento || "Sem documento", width)}\n`;
  if (conta.telefone) cupom += `${posCenter(conta.telefone, width)}\n`;
  cupom += `${posCenter("COMPROVANTE DE COMANDA", width)}\n`;
  cupom += "\n";

  cupom += "\x1B\x61\x00";
  cupom += `${separator}\n`;
  cupom += `${posLine(`Comanda: ${comanda.Uid}`, width)}\n`;
  cupom += `${posLine(`Status: ${comanda.status}`, width)}\n`;
  cupom += `${posLine(`Abertura: ${formatComandaReceiptDateTime(comanda.abertura) || "-"}`, width)}\n`;
  if (comanda.fechamento) {
    cupom += `${posLine(`Fechamento: ${formatComandaReceiptDateTime(comanda.fechamento) || "-"}`, width)}\n`;
  }
  if (comanda.faturamento) {
    cupom += `${posLine(`Faturamento: ${formatComandaReceiptDateTime(comanda.faturamento) || "-"}`, width)}\n`;
  }
  cupom += `${posLine(`Cliente: ${comanda.clienteNomeSnapshot || "Nao informado"}`, width)}\n`;
  cupom += `${separator}\n`;
  cupom += `${posLine("ITEM              QTD  VL.UN  TOTAL", width)}\n`;
  cupom += `${separator}\n`;

  for (const item of comanda.itens) {
    const quantity = new Decimal(item.quantidade).toString();
    cupom += `${posLine(item.nomeSnapshot, width)}\n`;
    cupom += `${posPair(
      `${quantity} x ${formatComandaReceiptCurrency(item.valorUnitarioSnapshot)}`,
      formatComandaReceiptCurrency(item.subtotal),
      width
    )}\n`;
    if (item.pagamentoId) cupom += `${posLine("  Item faturado", width)}\n`;
  }

  cupom += `${separator}\n`;
  cupom += `${posPair("TOTAL", formatComandaReceiptCurrency(comanda.total), width)}\n`;
  cupom += `${posPair("PAGO", formatComandaReceiptCurrency(totalPago), width)}\n`;
  cupom += `${posPair("EM ABERTO", formatComandaReceiptCurrency(aberto), width)}\n`;

  if (comanda.pagamentos.length) {
    cupom += `${separator}\n`;
    cupom += `${posLine("PAGAMENTOS", width)}\n`;
    for (const pagamento of comanda.pagamentos) {
      cupom += `${posPair(
        `${pagamento.metodo} ${formatComandaReceiptDateTime(pagamento.dataPagamento) || ""}`.trim(),
        formatComandaReceiptCurrency(pagamento.valor),
        width
      )}\n`;
    }
  }

  if (comanda.observacao) {
    cupom += `${separator}\n`;
    cupom += `${posLine(`Obs: ${comanda.observacao}`, width)}\n`;
  }

  cupom += `${separator}\n`;
  cupom += "\x1B\x61\x01";
  cupom += `${posCenter("Cupom nao fiscal", width)}\n`;
  cupom += `${posCenter("Obrigado pela preferencia!", width)}\n\n`;
  cupom += "\x1B\x64\x03";
  cupom += "\x1D\x56\x00";

  return cupom;
}

export type UsuarioPermissionShape = {
  permissao?: string | null;
  superAdmin?: boolean | null;
};

export function getUsuarioPermissionLevel(usuario: UsuarioPermissionShape) {
  if (usuario.superAdmin) return 100;

  switch (usuario.permissao) {
    case "root":
      return 5;
    case "admin":
      return 4;
    case "gerente":
      return 3;
    case "tecnico":
    case "vendedor":
      return 2;
    case "usuario":
      return 1;
    default:
      return 0;
  }
}
