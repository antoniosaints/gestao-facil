type ItemVendaLike = {
  itemName?: string | null;
  produto?: { nome?: string | null; nomeVariante?: string | null } | null;
  servico?: { nome?: string | null } | null;
};

/**
 * Nome exibível de um item de venda.
 *
 * `ItensVendas.produtoId` é nulável com `onDelete: SetNull`: apagar um produto zera a
 * referência nas vendas antigas. O item também pode ser um serviço ou texto livre
 * (`itemName`). Sem esta cadeia de fallback, `item.produto.nome` lança e o cupom da
 * venda inteira falha — a venda vira impossível de reimprimir.
 *
 * Mesma convenção de variante usada em controllers/produtos/graficos.ts.
 */
export function getNomeItemVenda(item: ItemVendaLike): string {
  const produto = item.produto;
  if (produto?.nome) {
    const variante = produto.nomeVariante;
    if (!variante || variante === "Padrão") return produto.nome;
    return `${produto.nome} / ${variante}`;
  }

  return item.servico?.nome || item.itemName || "Item removido";
}
