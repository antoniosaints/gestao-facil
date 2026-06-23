export function canDiscardProdutoStock(
  estoqueAtual: number,
  quantidade: number
) {
  return quantidade > 0 && estoqueAtual >= quantidade;
}

export function getProdutoDescarteUpdate(quantidade: number) {
  return {
    estoque: {
      decrement: quantidade,
    },
  };
}
