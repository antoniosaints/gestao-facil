import { Request, Response } from "express";
import dayjs from "dayjs";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import {
  mediaMs,
  montarCiclosAtendimento,
  type CicloAtendimento,
  type CicloStatus,
} from "../../services/whatsapp/whatsappAtendimento";

// Teto defensivo: os ciclos são reconstruídos em memória a partir do log, então limitamos a
// quantidade de eventos lidos por requisição. O relatório é por período; períodos gigantes
// devem ser fatiados pelo filtro em vez de derrubar a API.
const MAX_EVENTOS = 20_000;

function getPeriodo(req: Request) {
  const { inicio, fim } = req.query;
  const start = inicio ? dayjs(inicio as string) : dayjs().startOf("month");
  const end = fim ? dayjs(fim as string) : dayjs().endOf("month");
  return { start: start.toDate(), end: end.toDate() };
}

function getContaId(req: Request) {
  return Number(getCustomRequest(req).customData.contaId);
}

function compareValues(a: unknown, b: unknown, order: "asc" | "desc") {
  const direction = order === "desc" ? -1 : 1;
  // Desconhecido (null) vai sempre para o fim, independente da direção: é ausência de dado,
  // não um valor baixo.
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  const numericA = Number(a as any);
  const numericB = Number(b as any);
  if (Number.isFinite(numericA) && Number.isFinite(numericB)) return (numericA - numericB) * direction;

  const normalizedA = String(a).toLowerCase();
  const normalizedB = String(b).toLowerCase();
  if (normalizedA < normalizedB) return -1 * direction;
  if (normalizedA > normalizedB) return 1 * direction;
  return 0;
}

type LinhaRelatorio = CicloAtendimento & {
  id: string;
  contato: string;
  telefone: string;
  instancia: string | null;
  atendente: string | null;
  // Eixo cronológico do ciclo, usado como ordenação padrão do relatório.
  ocorridoEm: Date | null;
};

// Carrega os eventos do período e reconstrói os ciclos, já com os dados de exibição da conversa.
async function carregarCiclos(contaId: number, start: Date, end: Date): Promise<LinhaRelatorio[]> {
  const eventos = await prisma.whatsAppConversaEvento.findMany({
    where: { contaId, createdAt: { gte: start, lte: end } },
    select: { conversaId: true, tipo: true, usuarioId: true, referenciaEm: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: MAX_EVENTOS,
  });
  if (!eventos.length) return [];

  const ciclos = montarCiclosAtendimento(eventos);

  const conversaIds = [...new Set(ciclos.map((c) => c.conversaId))];
  const atendenteIds = [...new Set(ciclos.map((c) => c.atendenteId).filter((id): id is number => id != null))];

  const [conversas, atendentes] = await Promise.all([
    prisma.whatsAppConversa.findMany({
      where: { contaId, id: { in: conversaIds } },
      select: {
        id: true,
        telefone: true,
        Contato: { select: { nome: true } },
        Instancia: { select: { nome: true } },
      },
    }),
    prisma.usuarios.findMany({ where: { contaId, id: { in: atendenteIds } }, select: { id: true, nome: true } }),
  ]);

  const conversaPorId = new Map(conversas.map((c) => [c.id, c]));
  const atendentePorId = new Map(atendentes.map((u) => [u.id, u.nome]));

  return ciclos.map((ciclo, i) => {
    const conversa = conversaPorId.get(ciclo.conversaId);
    return {
      ...ciclo,
      // A conversa pode ter vários ciclos, então o id da linha combina conversa e posição.
      id: `${ciclo.conversaId}-${i}`,
      contato: conversa?.Contato?.nome || conversa?.telefone || "—",
      telefone: conversa?.telefone ?? "—",
      instancia: conversa?.Instancia?.nome ?? null,
      atendente: ciclo.atendenteId ? (atendentePorId.get(ciclo.atendenteId) ?? "Desconhecido") : null,
      ocorridoEm: ciclo.finalizadoEm ?? ciclo.assumidoEm ?? ciclo.entrouFilaEm,
    };
  });
}

function aplicarFiltros(
  linhas: LinhaRelatorio[],
  filtros: { atendenteId?: number; status?: string; search?: string },
) {
  let resultado = linhas;
  if (filtros.atendenteId) resultado = resultado.filter((l) => l.atendenteId === filtros.atendenteId);
  if (filtros.status && filtros.status !== "TODOS") resultado = resultado.filter((l) => l.status === filtros.status);
  if (filtros.search) {
    const termo = filtros.search.toLowerCase();
    resultado = resultado.filter(
      (l) =>
        l.contato.toLowerCase().includes(termo) ||
        l.telefone.toLowerCase().includes(termo) ||
        (l.atendente ?? "").toLowerCase().includes(termo),
    );
  }
  return resultado;
}

/**
 * Tabela do relatório: uma linha por ciclo de atendimento, no contrato de paginação que o
 * componente DataTable já consome.
 */
export async function getRelatorioAtendimentos(req: Request, res: Response): Promise<any> {
  try {
    const contaId = getContaId(req);
    const { start, end } = getPeriodo(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));

    // O DataTable manda `sortBy=id` quando o usuário não escolheu coluna, mas aqui o id é
    // sintético (conversa+ciclo) e ordenar por ele não diz nada. Nesse caso caímos no eixo
    // cronológico, do mais recente para o mais antigo, que é como se lê um relatório.
    const sortByBruto = req.query.sortBy as string | undefined;
    const ordenacaoPadrao = !sortByBruto || sortByBruto === "id";
    const sortBy = ordenacaoPadrao ? "ocorridoEm" : sortByBruto;
    const order: "asc" | "desc" = ordenacaoPadrao ? "desc" : req.query.order === "desc" ? "desc" : "asc";

    const linhas = aplicarFiltros(await carregarCiclos(contaId, start, end), {
      atendenteId: req.query.atendenteId ? Number(req.query.atendenteId) : undefined,
      status: req.query.status as string | undefined,
      search: (req.query.search as string) || undefined,
    });

    const ordenadas = [...linhas].sort((a, b) =>
      compareValues(
        a[sortBy as keyof LinhaRelatorio] instanceof Date
          ? (a[sortBy as keyof LinhaRelatorio] as Date).getTime()
          : a[sortBy as keyof LinhaRelatorio],
        b[sortBy as keyof LinhaRelatorio] instanceof Date
          ? (b[sortBy as keyof LinhaRelatorio] as Date).getTime()
          : b[sortBy as keyof LinhaRelatorio],
        order,
      ),
    );

    const total = ordenadas.length;
    return res.json({
      data: ordenadas.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (error) {
    handleError(res, error);
  }
}

/**
 * Resumo do relatório: totais do período e desempenho por atendente.
 *
 * Médias ignoram amostras desconhecidas (ciclos iniciados antes da janela não têm espera
 * medida), então `null` aqui significa "sem amostra" e não zero.
 */
export async function getRelatorioAtendimentosResumo(req: Request, res: Response): Promise<any> {
  try {
    const contaId = getContaId(req);
    const { start, end } = getPeriodo(req);

    const linhas = aplicarFiltros(await carregarCiclos(contaId, start, end), {
      atendenteId: req.query.atendenteId ? Number(req.query.atendenteId) : undefined,
    });

    const contar = (status: CicloStatus) => linhas.filter((l) => l.status === status).length;
    const finalizados = linhas.filter((l) => l.status === "FINALIZADO");

    const porAtendente = new Map<
      number,
      { atendenteId: number; nome: string; finalizados: number; emAndamento: number; esperas: (number | null)[]; duracoes: (number | null)[] }
    >();
    for (const linha of linhas) {
      if (!linha.atendenteId) continue;
      const atual = porAtendente.get(linha.atendenteId) ?? {
        atendenteId: linha.atendenteId,
        nome: linha.atendente ?? "Desconhecido",
        finalizados: 0,
        emAndamento: 0,
        esperas: [],
        duracoes: [],
      };
      if (linha.status === "FINALIZADO") atual.finalizados += 1;
      if (linha.status === "EM_ANDAMENTO") atual.emAndamento += 1;
      atual.esperas.push(linha.esperaMs);
      atual.duracoes.push(linha.duracaoMs);
      porAtendente.set(linha.atendenteId, atual);
    }

    return res.json({
      periodo: { inicio: start, fim: end },
      totais: {
        atendimentos: linhas.length,
        finalizados: finalizados.length,
        emAndamento: contar("EM_ANDAMENTO"),
        naFila: contar("NA_FILA"),
        tempoMedioEsperaMs: mediaMs(linhas.map((l) => l.esperaMs)),
        tempoMedioResolucaoMs: mediaMs(finalizados.map((l) => l.duracaoMs)),
      },
      porAtendente: [...porAtendente.values()]
        .map((a) => ({
          atendenteId: a.atendenteId,
          nome: a.nome,
          finalizados: a.finalizados,
          emAndamento: a.emAndamento,
          tempoMedioEsperaMs: mediaMs(a.esperas),
          tempoMedioResolucaoMs: mediaMs(a.duracoes),
        }))
        .sort((a, b) => b.finalizados - a.finalizados),
    });
  } catch (error) {
    handleError(res, error);
  }
}
