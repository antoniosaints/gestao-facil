export interface MaterialPriceInput {
  custoUnitario: number;
  valorUnitario: number;
}

/**
 * Preserva os valores confirmados na linha do orçamento. O cadastro do produto
 * serve apenas para preencher o formulário; depois disso, inclusive quando o
 * valor informado for zero, a linha salva é a fonte do snapshot financeiro.
 */
export function snapshotMaterialPrices(material: MaterialPriceInput) {
  return {
    custoUnitario: Number(material.custoUnitario),
    valorUnitario: Number(material.valorUnitario),
  };
}
