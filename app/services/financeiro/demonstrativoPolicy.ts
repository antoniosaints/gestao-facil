import Decimal from "decimal.js";
import {
  addMonths,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  endOfDay,
  endOfMonth,
  isFirstDayOfMonth,
  isLastDayOfMonth,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";

/// Regime de apuração do demonstrativo.
/// - COMPETENCIA: reconhece pelo vencimento, incluindo parcelas ainda em aberto.
/// - CAIXA: reconhece pela data de pagamento, apenas o que foi efetivamente pago.
export type RegimeDemonstrativo = "COMPETENCIA" | "CAIXA";

export type ParcelaDemonstrativo = {
  valor: Decimal.Value;
  valorPago?: Decimal.Value | null;
  vencimento: Date;
  dataPagamento?: Date | null;
  pago: boolean;
  tipo: "RECEITA" | "DESPESA";
  categoriaId?: number | null;
};

export type CategoriaArvore = {
  id: number;
  nome: string;
  parentId?: number | null;
};

export type LinhaDemonstrativo = {
  categoriaId: number | null;
  nome: string;
  valor: Decimal;
  participacao: number;
  anterior: Decimal;
  variacao: number | null;
  subcategorias: Array<{
    categoriaId: number | null;
    nome: string;
    valor: Decimal;
    participacao: number;
    anterior: Decimal;
    variacao: number | null;
  }>;
};

export const SEM_CATEGORIA = "Sem categoria";

export function normalizeRegime(valor?: string | null): RegimeDemonstrativo {
  return String(valor || "").toUpperCase() === "CAIXA" ? "CAIXA" : "COMPETENCIA";
}

/// Data em que a parcela é reconhecida no regime escolhido.
export function getDataReconhecimento(
  parcela: ParcelaDemonstrativo,
  regime: RegimeDemonstrativo,
): Date | null {
  if (regime === "CAIXA") {
    return parcela.pago && parcela.dataPagamento ? parcela.dataPagamento : null;
  }
  return parcela.vencimento;
}

/// Valor reconhecido: no caixa vale o que entrou de fato; na competência, o previsto.
export function getValorReconhecido(
  parcela: ParcelaDemonstrativo,
  regime: RegimeDemonstrativo,
): Decimal {
  if (regime === "CAIXA") {
    return new Decimal(parcela.valorPago ?? parcela.valor ?? 0);
  }
  return new Decimal(parcela.valor ?? 0);
}

export function parcelaNoPeriodo(
  parcela: ParcelaDemonstrativo,
  regime: RegimeDemonstrativo,
  inicio: Date,
  fim: Date,
) {
  const data = getDataReconhecimento(parcela, regime);
  if (!data) return false;
  return data >= inicio && data <= fim;
}

/// Período imediatamente anterior, para a análise horizontal.
/// Quando o filtro cobre meses inteiros, o comparativo anda por mês (julho → junho,
/// 3º trimestre → 2º trimestre); contar dias corridos faria um mês de 31 dias
/// invadir o mês retrasado. Para recortes quebrados, usa a mesma quantidade de dias.
export function resolvePeriodoAnterior(inicio: Date, fim: Date) {
  const inicioDia = startOfDay(inicio);
  const fimDia = startOfDay(fim);

  if (isFirstDayOfMonth(inicioDia) && isLastDayOfMonth(fimDia)) {
    const meses = differenceInCalendarMonths(fimDia, inicioDia) + 1;
    return {
      inicio: startOfMonth(subMonths(inicioDia, meses)),
      fim: endOfDay(endOfMonth(subMonths(fimDia, meses))),
    };
  }

  const dias = differenceInCalendarDays(fimDia, inicioDia) + 1;
  return {
    inicio: startOfDay(subDays(inicioDia, dias)),
    fim: endOfDay(subDays(inicioDia, 1)),
  };
}

/// Resolve a categoria raiz de cada categoria do plano de contas. O DRE agrupa
/// pela raiz e detalha as subcategorias dentro dela.
export function mapearRaizes(categorias: CategoriaArvore[]) {
  const porId = new Map(categorias.map((categoria) => [categoria.id, categoria]));
  const raizes = new Map<number, CategoriaArvore>();

  for (const categoria of categorias) {
    let atual = categoria;
    const visitados = new Set<number>([atual.id]);

    while (atual.parentId) {
      const pai = porId.get(atual.parentId);
      // Guarda contra ciclos em dados inconsistentes: para no primeiro repetido.
      if (!pai || visitados.has(pai.id)) break;
      visitados.add(pai.id);
      atual = pai;
    }

    raizes.set(categoria.id, atual);
  }

  return raizes;
}

/// Casas decimais dos percentuais no payload. Fica acima do que qualquer saída
/// exibe (1 ou 2 casas) para que o arredondamento aconteça só na formatação:
/// arredondar aqui para 2 e de novo na tela transformava 12,647% em 12,7%.
const CASAS_PERCENTUAL = 4;

/// Variação percentual entre dois períodos. Sem base anterior a variação é
/// indefinida (null) — devolver 100% ou Infinity distorceria a leitura.
export function calcularVariacao(atual: Decimal, anterior: Decimal): number | null {
  if (anterior.isZero()) return null;
  return atual
    .minus(anterior)
    .dividedBy(anterior.abs())
    .times(100)
    .toDecimalPlaces(CASAS_PERCENTUAL)
    .toNumber();
}

/// Análise vertical: participação da linha sobre a base (receita total do período).
export function calcularParticipacao(valor: Decimal, base: Decimal): number {
  if (base.isZero()) return 0;
  return valor.dividedBy(base).times(100).toDecimalPlaces(CASAS_PERCENTUAL).toNumber();
}

type AcumuladorCategoria = {
  categoriaId: number | null;
  nome: string;
  valor: Decimal;
  anterior: Decimal;
  subcategorias: Map<string, { categoriaId: number | null; nome: string; valor: Decimal; anterior: Decimal }>;
};

/// Agrupa as parcelas pela categoria raiz, detalhando as subcategorias e já
/// cruzando com os valores do período anterior.
export function agruparPorCategoria(
  parcelas: Array<ParcelaDemonstrativo & { periodo: "ATUAL" | "ANTERIOR" }>,
  categorias: CategoriaArvore[],
  regime: RegimeDemonstrativo,
  tipo: "RECEITA" | "DESPESA",
  base: Decimal,
): LinhaDemonstrativo[] {
  const raizes = mapearRaizes(categorias);
  const porId = new Map(categorias.map((categoria) => [categoria.id, categoria]));
  const grupos = new Map<string, AcumuladorCategoria>();

  for (const parcela of parcelas) {
    if (parcela.tipo !== tipo) continue;

    const categoria = parcela.categoriaId ? porId.get(parcela.categoriaId) : undefined;
    const raiz = categoria ? raizes.get(categoria.id) : undefined;
    const chaveGrupo = raiz ? String(raiz.id) : SEM_CATEGORIA;
    const valor = getValorReconhecido(parcela, regime);

    let grupo = grupos.get(chaveGrupo);
    if (!grupo) {
      grupo = {
        categoriaId: raiz?.id ?? null,
        nome: raiz?.nome ?? SEM_CATEGORIA,
        valor: new Decimal(0),
        anterior: new Decimal(0),
        subcategorias: new Map(),
      };
      grupos.set(chaveGrupo, grupo);
    }

    if (parcela.periodo === "ATUAL") grupo.valor = grupo.valor.plus(valor);
    else grupo.anterior = grupo.anterior.plus(valor);

    // Só vira linha de detalhe quando a categoria do lançamento não é a própria raiz.
    const ehSubcategoria = Boolean(categoria && raiz && categoria.id !== raiz.id);
    const chaveSub = ehSubcategoria ? String(categoria!.id) : chaveGrupo;
    const nomeSub = ehSubcategoria ? categoria!.nome : grupo.nome;

    let sub = grupo.subcategorias.get(chaveSub);
    if (!sub) {
      sub = {
        categoriaId: ehSubcategoria ? categoria!.id : grupo.categoriaId,
        nome: nomeSub,
        valor: new Decimal(0),
        anterior: new Decimal(0),
      };
      grupo.subcategorias.set(chaveSub, sub);
    }

    if (parcela.periodo === "ATUAL") sub.valor = sub.valor.plus(valor);
    else sub.anterior = sub.anterior.plus(valor);
  }

  return Array.from(grupos.values())
    .map((grupo) => ({
      categoriaId: grupo.categoriaId,
      nome: grupo.nome,
      valor: grupo.valor,
      participacao: calcularParticipacao(grupo.valor, base),
      anterior: grupo.anterior,
      variacao: calcularVariacao(grupo.valor, grupo.anterior),
      subcategorias: Array.from(grupo.subcategorias.values())
        .map((sub) => ({
          categoriaId: sub.categoriaId,
          nome: sub.nome,
          valor: sub.valor,
          participacao: calcularParticipacao(sub.valor, base),
          anterior: sub.anterior,
          variacao: calcularVariacao(sub.valor, sub.anterior),
        }))
        .sort((a, b) => b.valor.comparedTo(a.valor) || a.nome.localeCompare(b.nome, "pt-BR")),
    }))
    .sort((a, b) => b.valor.comparedTo(a.valor) || a.nome.localeCompare(b.nome, "pt-BR"));
}

export type PontoMensal = {
  mes: string;
  receitas: Decimal;
  despesas: Decimal;
  resultado: Decimal;
};

/// Série mês a mês do período, incluindo meses sem movimento (para o gráfico
/// não "pular" períodos vazios e sugerir uma continuidade que não existe).
export function montarSerieMensal(
  parcelas: ParcelaDemonstrativo[],
  regime: RegimeDemonstrativo,
  inicio: Date,
  fim: Date,
): PontoMensal[] {
  const buckets = new Map<string, PontoMensal>();

  let cursor = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
  const limite = new Date(fim.getFullYear(), fim.getMonth(), 1);

  while (cursor <= limite) {
    const chave = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(chave, {
      mes: chave,
      receitas: new Decimal(0),
      despesas: new Decimal(0),
      resultado: new Decimal(0),
    });
    cursor = addMonths(cursor, 1);
  }

  for (const parcela of parcelas) {
    const data = getDataReconhecimento(parcela, regime);
    if (!data) continue;

    const chave = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(chave);
    if (!bucket) continue;

    const valor = getValorReconhecido(parcela, regime);
    if (parcela.tipo === "RECEITA") bucket.receitas = bucket.receitas.plus(valor);
    else bucket.despesas = bucket.despesas.plus(valor);
  }

  return Array.from(buckets.values()).map((ponto) => ({
    ...ponto,
    resultado: ponto.receitas.minus(ponto.despesas),
  }));
}
