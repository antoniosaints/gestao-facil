/**
 * Árvore de categorias financeiras.
 *
 * O Prisma não faz CTE recursiva, mas a tabela é pequena e sempre escopada por
 * conta: buscamos a lista plana em UMA query e montamos a hierarquia em memória.
 * Todas as funções aqui são puras (sem banco) para poderem ser testadas.
 */

export type CategoriaFlat = {
  id: number;
  nome: string;
  parentId: number | null;
  Uid?: string;
};

export type CategoriaNode = CategoriaFlat & {
  nivel: number;
  /// Caminho completo até a raiz, ex.: "Custos fixos › Aluguel › Sala 2".
  caminho: string;
  totalLancamentos: number;
  /// Quantidade de descendentes em todos os níveis abaixo.
  totalDescendentes: number;
  filhos: CategoriaNode[];
};

export const PROFUNDIDADE_MAXIMA_CATEGORIA = 5;
export const SEPARADOR_CAMINHO = " › ";

function ordenarPorNome(a: CategoriaFlat, b: CategoriaFlat) {
  return a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });
}

function agruparPorPai(categorias: CategoriaFlat[]) {
  const existentes = new Set(categorias.map((item) => item.id));
  const porPai = new Map<number | null, CategoriaFlat[]>();

  for (const categoria of categorias) {
    // Categoria órfã (pai apagado ou de outra conta) é tratada como raiz.
    const chave =
      categoria.parentId !== null && existentes.has(categoria.parentId) ? categoria.parentId : null;
    const irmas = porPai.get(chave) ?? [];
    irmas.push(categoria);
    porPai.set(chave, irmas);
  }

  for (const irmas of porPai.values()) {
    irmas.sort(ordenarPorNome);
  }

  return porPai;
}

export function montarArvoreCategorias(
  categorias: CategoriaFlat[],
  totaisPorCategoria: Map<number, number> = new Map(),
): CategoriaNode[] {
  const porPai = agruparPorPai(categorias);
  // Protege contra ciclo em dado corrompido (A → B → A), que faria laço infinito.
  const visitados = new Set<number>();

  const montar = (categoria: CategoriaFlat, nivel: number, caminhoPai: string): CategoriaNode => {
    visitados.add(categoria.id);

    const caminho = caminhoPai ? `${caminhoPai}${SEPARADOR_CAMINHO}${categoria.nome}` : categoria.nome;
    const filhos = (porPai.get(categoria.id) ?? [])
      .filter((filho) => !visitados.has(filho.id))
      .map((filho) => montar(filho, nivel + 1, caminho));

    return {
      ...categoria,
      nivel,
      caminho,
      totalLancamentos: totaisPorCategoria.get(categoria.id) ?? 0,
      totalDescendentes: filhos.reduce((acc, filho) => acc + 1 + filho.totalDescendentes, 0),
      filhos,
    };
  };

  return (porPai.get(null) ?? []).map((raiz) => montar(raiz, 0, ""));
}

/**
 * Rótulo curto para campos de seleção: o nome da categoria escolhida vem sempre
 * inteiro, e os ancestrais são condensados (o truncate do CSS cortaria o fim,
 * que é justamente a parte que identifica a categoria).
 *
 *   "Vendas"                              -> "Vendas"
 *   "Custos fixos › Aluguel"              -> "Custos fixos › Aluguel"
 *   "Custos fixos › Aluguel › Sala 2"     -> "… › Aluguel › Sala 2"
 */
export function rotuloCompactoCategoria(caminho: string) {
  const partes = caminho.split(SEPARADOR_CAMINHO);
  if (partes.length <= 2) return caminho;
  return ["…", ...partes.slice(-2)].join(SEPARADOR_CAMINHO);
}

/// Achata a árvore na ordem de exibição (pai seguido dos seus descendentes).
export function achatarArvoreCategorias(nodes: CategoriaNode[]): CategoriaNode[] {
  return nodes.flatMap((node) => [node, ...achatarArvoreCategorias(node.filhos)]);
}

export function coletarDescendentes(categorias: CategoriaFlat[], id: number) {
  const filhosPorPai = new Map<number, number[]>();

  for (const categoria of categorias) {
    if (categoria.parentId === null) continue;
    const filhos = filhosPorPai.get(categoria.parentId) ?? [];
    filhos.push(categoria.id);
    filhosPorPai.set(categoria.parentId, filhos);
  }

  const descendentes = new Set<number>();
  const fila = [...(filhosPorPai.get(id) ?? [])];

  while (fila.length) {
    const atual = fila.shift() as number;
    if (descendentes.has(atual) || atual === id) continue;
    descendentes.add(atual);
    fila.push(...(filhosPorPai.get(atual) ?? []));
  }

  return descendentes;
}

/// Nível da categoria contando a partir da raiz (raiz = 0).
export function nivelDaCategoria(categorias: CategoriaFlat[], id: number) {
  const porId = new Map(categorias.map((item) => [item.id, item]));
  let nivel = 0;
  let atual = porId.get(id);
  const visitados = new Set<number>();

  while (atual?.parentId != null && !visitados.has(atual.id)) {
    visitados.add(atual.id);
    const pai = porId.get(atual.parentId);
    if (!pai) break;
    nivel += 1;
    atual = pai;
  }

  return nivel;
}

/// Altura da subárvore: 0 quando a categoria não tem filhas.
export function alturaDaSubarvore(categorias: CategoriaFlat[], id: number) {
  const filhosPorPai = new Map<number, number[]>();

  for (const categoria of categorias) {
    if (categoria.parentId === null) continue;
    const filhos = filhosPorPai.get(categoria.parentId) ?? [];
    filhos.push(categoria.id);
    filhosPorPai.set(categoria.parentId, filhos);
  }

  const medir = (atual: number, visitados: Set<number>): number => {
    if (visitados.has(atual)) return 0;
    visitados.add(atual);
    const filhos = filhosPorPai.get(atual) ?? [];
    if (!filhos.length) return 0;
    return 1 + Math.max(...filhos.map((filho) => medir(filho, visitados)));
  };

  return medir(id, new Set());
}

export type ResultadoValidacaoMovimento =
  | { permitido: true }
  | {
      permitido: false;
      motivo: "CATEGORIA_INEXISTENTE" | "PAI_INEXISTENTE" | "CICLO" | "PROFUNDIDADE";
      mensagem: string;
    };

export function validarMovimentoCategoria(args: {
  categorias: CategoriaFlat[];
  id: number;
  novoPaiId: number | null;
  profundidadeMaxima?: number;
}): ResultadoValidacaoMovimento {
  const profundidadeMaxima = args.profundidadeMaxima ?? PROFUNDIDADE_MAXIMA_CATEGORIA;
  const categoria = args.categorias.find((item) => item.id === args.id);

  if (!categoria) {
    return {
      permitido: false,
      motivo: "CATEGORIA_INEXISTENTE",
      mensagem: "Categoria não encontrada.",
    };
  }

  if (args.novoPaiId === null) return { permitido: true };

  if (args.novoPaiId === args.id) {
    return {
      permitido: false,
      motivo: "CICLO",
      mensagem: "Uma categoria não pode ser subcategoria dela mesma.",
    };
  }

  const novoPai = args.categorias.find((item) => item.id === args.novoPaiId);

  if (!novoPai) {
    return {
      permitido: false,
      motivo: "PAI_INEXISTENTE",
      mensagem: "Categoria de destino não encontrada.",
    };
  }

  if (coletarDescendentes(args.categorias, args.id).has(args.novoPaiId)) {
    return {
      permitido: false,
      motivo: "CICLO",
      mensagem: "Não é possível mover uma categoria para dentro de uma subcategoria dela mesma.",
    };
  }

  const nivelFinal =
    nivelDaCategoria(args.categorias, args.novoPaiId) + 1 + alturaDaSubarvore(args.categorias, args.id);

  if (nivelFinal + 1 > profundidadeMaxima) {
    return {
      permitido: false,
      motivo: "PROFUNDIDADE",
      mensagem: `A árvore de categorias aceita no máximo ${profundidadeMaxima} níveis.`,
    };
  }

  return { permitido: true };
}
