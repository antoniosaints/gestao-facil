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
