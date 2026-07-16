import { FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { prisma } from "../../../utils/prisma";
import { hasPermission } from "../../../helpers/userPermission";
import { gerarIdUnicoComMetaFinal } from "../../../helpers/generateUUID";
import { CustomData } from "../../../helpers/getCustomRequest";

const negado = { response: { error: "Acesso negado, informe o usuario que ele não tem permissão!" } };

function desdeDias(dias?: number): Date {
  const d = Math.min(365, Math.max(1, Math.round(Number(dias) || 30)));
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000);
}

const TIPOS_MOV = ["ENTRADA", "SAIDA", "DESCARTE", "TRANSFERENCIA"] as const;
const TIPOS_LANC = ["RECEITA", "DESPESA"] as const;
const STATUS_LANC = ["PENDENTE", "PAGO", "ATRASADO", "PARCIAL"] as const;
const STATUS_OS = ["ABERTA", "ORCAMENTO", "APROVADA", "ANDAMENTO", "FATURADA", "CANCELADA"] as const;
const FORMAS_PGTO = ["PIX", "DINHEIRO", "CARTAO", "BOLETO", "TRANSFERENCIA", "CHEQUE", "CREDITO", "DEBITO", "GATEWAY", "OUTRO"] as const;

function narrow<T extends readonly string[]>(list: T, value?: string | null): T[number] | undefined {
  return value && (list as readonly string[]).includes(value) ? (value as T[number]) : undefined;
}

export const systemFunctionsGestaoIA = {
  // Consulta movimentações de estoque (entradas/saídas) por produto/tipo/período.
  getMovimentacoesEstoque: async (
    args: { produto?: string; tipo?: string; dias?: number },
    request: CustomData,
  ) => {
    const auth = await hasPermission(request, 2);
    if (!auth) return negado;
    const tipo = narrow(TIPOS_MOV, args.tipo);
    const response = await prisma.movimentacoesEstoque.findMany({
      where: {
        contaId: request.contaId,
        ...(tipo ? { tipo } : {}),
        data: { gte: desdeDias(args.dias) },
        ...(args.produto ? { Produto: { nome: { contains: args.produto } } } : {}),
      },
      orderBy: { data: "desc" },
      take: 40,
      select: {
        data: true,
        tipo: true,
        quantidade: true,
        custo: true,
        Produto: { select: { nome: true, nomeVariante: true } },
      },
    });
    return { response };
  },

  // Consulta lançamentos financeiros por período, com filtro opcional de tipo e status.
  getLancamentosPorPeriodo: async (
    args: { tipo?: string; status?: string; dias?: number },
    request: CustomData,
  ) => {
    const auth = await hasPermission(request, 3);
    if (!auth) return negado;
    const tipo = narrow(TIPOS_LANC, args.tipo);
    const status = narrow(STATUS_LANC, args.status);
    const response = await prisma.lancamentoFinanceiro.findMany({
      where: {
        contaId: request.contaId,
        dataLancamento: { gte: desdeDias(args.dias) },
        ...(tipo ? { tipo } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { dataLancamento: "desc" },
      take: 50,
      select: {
        descricao: true,
        valorTotal: true,
        tipo: true,
        status: true,
        dataLancamento: true,
        categoria: { select: { nome: true } },
      },
    });
    return { response };
  },

  // Consulta ordens de serviço por status.
  getOrdensPorStatus: async (
    args: { status?: string },
    request: CustomData,
  ) => {
    const auth = await hasPermission(request, 2);
    if (!auth) return negado;
    const status = narrow(STATUS_OS, args.status);
    const response = await prisma.ordensServico.findMany({
      where: { contaId: request.contaId, ...(status ? { status } : {}) },
      orderBy: { data: "desc" },
      take: 40,
      select: {
        data: true,
        status: true,
        Cliente: { select: { nome: true } },
      },
    });
    return { response };
  },

  // Cria um lançamento financeiro (receita/despesa). Resolve a categoria pelo nome (cria se não
  // existir). Requer papel de gerente ou acima.
  createLancamentoFinanceiro: async (
    args: { descricao: string; valor: number; tipo: string; categoria?: string; formaPagamento?: string; pago?: boolean },
    request: CustomData,
  ) => {
    const auth = await hasPermission(request, 3);
    if (!auth) return negado;

    const tipo = narrow(TIPOS_LANC, args.tipo);
    if (!tipo) return { response: { error: "Tipo inválido. Use RECEITA ou DESPESA." } };
    const valor = Number(args.valor);
    if (!Number.isFinite(valor) || valor <= 0) {
      return { response: { error: "Informe um valor maior que zero." } };
    }
    const descricao = String(args.descricao || "").trim();
    if (!descricao) return { response: { error: "Informe a descrição do lançamento." } };

    // Resolve/cria a categoria (nome informado ou "Geral").
    const nomeCategoria = (args.categoria || "Geral").trim();
    let categoria = await prisma.categoriaFinanceiro.findFirst({
      where: { contaId: request.contaId, nome: { contains: nomeCategoria } },
      select: { id: true, nome: true },
    });
    if (!categoria) {
      categoria = await prisma.categoriaFinanceiro.create({
        data: { contaId: request.contaId, nome: nomeCategoria, Uid: gerarIdUnicoComMetaFinal("CAT") },
        select: { id: true, nome: true },
      });
    }

    const formaPagamento = narrow(FORMAS_PGTO, args.formaPagamento) ?? "DINHEIRO";
    const status = args.pago ? "PAGO" : "PENDENTE";

    const lancamento = await prisma.lancamentoFinanceiro.create({
      data: {
        contaId: request.contaId,
        descricao,
        valorTotal: valor,
        valorBruto: valor,
        tipo,
        formaPagamento,
        status,
        categoriaId: categoria.id,
        dataLancamento: new Date(),
        origemSistema: "MANUAL",
        Uid: gerarIdUnicoComMetaFinal("FIN"),
      },
      select: { id: true, descricao: true, valorTotal: true, tipo: true, status: true, categoria: { select: { nome: true } } },
    });
    return { response: { ...lancamento, mensagem: "Lançamento criado com sucesso." } };
  },
};

export const toolsGestao: FunctionDeclaration[] = [
  {
    name: "getMovimentacoesEstoque",
    description:
      "Consulta as movimentações de estoque (entradas/saídas) do sistema em um período. Filtros opcionais: nome do produto, tipo (ENTRADA, SAIDA, DESCARTE, TRANSFERENCIA) e janela em dias. Mostre em tabela e formate datas no padrão brasileiro.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        produto: { type: SchemaType.STRING, description: "Nome do produto (opcional)" },
        tipo: { type: SchemaType.STRING, description: "Tipo da movimentação (opcional): ENTRADA, SAIDA, DESCARTE ou TRANSFERENCIA" },
        dias: { type: SchemaType.NUMBER, description: "Janela de dias para trás (padrão 30)" },
      },
    },
  },
  {
    name: "getLancamentosPorPeriodo",
    description:
      "Consulta os lançamentos financeiros em um período. Filtros opcionais: tipo (RECEITA ou DESPESA), status (PENDENTE, PAGO, ATRASADO, PARCIAL) e janela em dias. Formate de forma resumida e datas no padrão brasileiro.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        tipo: { type: SchemaType.STRING, description: "RECEITA ou DESPESA (opcional)" },
        status: { type: SchemaType.STRING, description: "PENDENTE, PAGO, ATRASADO ou PARCIAL (opcional)" },
        dias: { type: SchemaType.NUMBER, description: "Janela de dias para trás (padrão 30)" },
      },
    },
  },
  {
    name: "getOrdensPorStatus",
    description:
      "Consulta as ordens de serviço filtrando por status (ABERTA, ORCAMENTO, APROVADA, ANDAMENTO, FATURADA, CANCELADA). Sem status, retorna as mais recentes. Mostre em tabela com o cliente e formate datas no padrão brasileiro.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        status: { type: SchemaType.STRING, description: "Status da OS (opcional)" },
      },
    },
  },
  {
    name: "createLancamentoFinanceiro",
    description:
      "Cria um lançamento financeiro (receita ou despesa). Sempre confirme os dados com o usuário antes de registrar. A categoria é opcional (informe o nome; será criada se não existir). Forma de pagamento é opcional (padrão DINHEIRO). Informe se já está pago.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        descricao: { type: SchemaType.STRING, description: "Descrição do lançamento" },
        valor: { type: SchemaType.NUMBER, description: "Valor do lançamento (maior que zero)" },
        tipo: { type: SchemaType.STRING, description: "RECEITA (entrada) ou DESPESA (saída)" },
        categoria: { type: SchemaType.STRING, description: "Nome da categoria (opcional)" },
        formaPagamento: { type: SchemaType.STRING, description: "PIX, DINHEIRO, CARTAO, BOLETO, TRANSFERENCIA, CHEQUE, CREDITO, DEBITO ou OUTRO (opcional)" },
        pago: { type: SchemaType.BOOLEAN, description: "true se já está pago; false/omitido = pendente" },
      },
      required: ["descricao", "valor", "tipo"],
    },
  },
];
