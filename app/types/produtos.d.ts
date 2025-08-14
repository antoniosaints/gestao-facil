export interface ProdutoCSV {
  nome: string;
  descricao?: string;
  preco: string;
  precoCompra?: string;
  entradas?: string;
  saidas?: string;
  unidade?: string;
  estoque: string;
  minimo: string;
  codigo?: string;
}

export interface ProdutoCreate {
  contaId: number;
  nome: string;
  descricao?: string | null;
  preco: number;
  precoCompra?: number | null;
  entradas: boolean;
  saidas: boolean;
  unidade?: string | null;
  estoque: number;
  minimo: number;
  codigo?: string | null;
}

export interface ImportResult {
  inseridos: number;
  erros: { linha: number; erro: string }[];
}
