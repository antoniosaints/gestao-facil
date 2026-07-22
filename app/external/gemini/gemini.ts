import { SchemaType, Tool } from "@google/generative-ai";
import { prisma } from "../../utils/prisma";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { CustomData } from "../../helpers/getCustomRequest";
import { hasPermission } from "../../helpers/userPermission";
import { systemFunctionsProdutosIA, toolsProducts } from "./tools/products";
import { systemFunctionsGestaoIA, toolsGestao } from "./tools/gestao";
import { resolverPeriodoIa, systemFunctionsAnaliseIA, toolsAnalise } from "./tools/analise";
import { buscarAjudaSistemaParaIa } from "../../services/ia/coreIaKnowledgeMapper";

const brlIa = (valor: number) =>
  Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Funções reais do seu sistema
export const systemFunctionsIA = {
  ...systemFunctionsProdutosIA,
  ...systemFunctionsGestaoIA,
  ...systemFunctionsAnaliseIA,
  buscarAjudaSistema: async (args: { consulta?: string }) => buscarAjudaSistemaParaIa(args),
  buscarClientePorNomeParaOperacao: async (args: { nome: string }, request: CustomData) => {
    const nome = String(args?.nome || "").trim();
    if (!nome) {
      return {
        encontrado: false,
        precisaConfirmacao: true,
        mensagem: "Informe o nome do cliente para buscar.",
        clientes: [],
      };
    }

    const clientes = await prisma.clientesFornecedores.findMany({
      where: {
        contaId: request.contaId,
        nome: { contains: nome },
      },
      select: {
        id: true,
        nome: true,
        status: true,
        documento: true,
        telefone: true,
        email: true,
      },
      orderBy: { nome: "asc" },
      take: 8,
    });

    const termo = nome.toLocaleLowerCase();
    const ordenados = clientes.sort((a, b) => {
      const an = a.nome.toLocaleLowerCase();
      const bn = b.nome.toLocaleLowerCase();
      const aExact = an === termo ? 0 : 1;
      const bExact = bn === termo ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aStarts = an.startsWith(termo) ? 0 : 1;
      const bStarts = bn.startsWith(termo) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.nome.localeCompare(b.nome);
    });

    if (!ordenados.length) {
      return {
        encontrado: false,
        precisaConfirmacao: true,
        mensagem: `Nenhum cliente encontrado com o nome "${nome}". Pergunte se deve cadastrar um novo cliente ou se o usuario quer tentar outro nome.`,
        clientes: [],
      };
    }

    return {
      encontrado: true,
      precisaConfirmacao: ordenados.length > 1,
      clienteId: ordenados.length === 1 ? ordenados[0].id : undefined,
      cliente: ordenados.length === 1 ? ordenados[0] : undefined,
      clientes: ordenados,
      mensagem: ordenados.length === 1
        ? "Cliente encontrado. Use clienteId internamente na proxima ferramenta; nao peca o ID ao usuario."
        : "Mais de um cliente encontrado. Peca ao usuario para confirmar qual cliente usando nome, documento, telefone ou email; nao peca o ID.",
    };
  },
  getClientesSistema: async (args: { cliente: string }, request: CustomData) => {
    const cliente = String(args?.cliente || "").trim();
    const response = await prisma.clientesFornecedores.findMany({
      where: {
        contaId: request.contaId,
        ...(cliente ? { nome: { contains: cliente } } : {}),
      },
      select: {
        id: true,
        nome: true,
        status: true,
        documento: true,
        endereco: true,
        email: true,
        telefone: true,
      },
      orderBy: { nome: "asc" },
      take: 20,
    });
    return {
      response,
      totalRetornado: response.length,
    };
  },
  // As três leituras abaixo devolvem TOTAIS já somados + uma amostra curta. Antes
  // retornavam 50 linhas cruas sem filtro de período, e o modelo tinha que somar
  // de cabeça — origem dos números errados em análises.
  getResumoFinanceiro: async (args: { inicio?: string; fim?: string; tipo?: string }, request: CustomData) => {
    const auth = await hasPermission(request, 3);
    if (!auth) return { response: { error: "Acesso negado, informe o usuario que ele não tem permissão!" } };

    const periodo = resolverPeriodoIa(args?.inicio, args?.fim);
    const tipo = String(args?.tipo || "").toUpperCase();

    const where = {
      contaId: request.contaId,
      dataLancamento: { gte: periodo.inicio, lte: periodo.fim },
      ...(tipo === "RECEITA" || tipo === "DESPESA" ? { tipo: tipo as any } : {}),
    };

    const [porTipo, lancamentos] = await Promise.all([
      prisma.lancamentoFinanceiro.groupBy({
        by: ["tipo"],
        _sum: { valorTotal: true },
        _count: { _all: true },
        where,
      }),
      prisma.lancamentoFinanceiro.findMany({
        where,
        select: { descricao: true, tipo: true, valorTotal: true, status: true, dataLancamento: true },
        orderBy: { valorTotal: "desc" },
        take: 15,
      }),
    ]);

    const soma = (t: string) => Number(porTipo.find((g) => g.tipo === t)?._sum.valorTotal ?? 0);
    const receitas = soma("RECEITA");
    const despesas = soma("DESPESA");

    return {
      periodo: {
        inicio: periodo.inicio.toISOString().slice(0, 10),
        fim: periodo.fim.toISOString().slice(0, 10),
        assumido: periodo.assumido,
      },
      totais: {
        receitas: brlIa(receitas),
        despesas: brlIa(despesas),
        saldo: brlIa(receitas - despesas),
        quantidade: porTipo.reduce((acc, g) => acc + g._count._all, 0),
      },
      maioresLancamentos: lancamentos.map((l) => ({
        descricao: l.descricao,
        tipo: l.tipo,
        valor: brlIa(Number(l.valorTotal || 0)),
        status: l.status,
        data: l.dataLancamento?.toISOString().slice(0, 10),
      })),
    };
  },
  getResumoOrdensServicos: async (args: { inicio?: string; fim?: string }, request: CustomData) => {
    const periodo = resolverPeriodoIa(args?.inicio, args?.fim);
    const where = { contaId: request.contaId, data: { gte: periodo.inicio, lte: periodo.fim } };

    const [porStatus, ordens] = await Promise.all([
      prisma.ordensServico.groupBy({ by: ["status"], _count: { _all: true }, where }),
      prisma.ordensServico.findMany({
        where,
        select: {
          Uid: true,
          status: true,
          data: true,
          desconto: true,
          Cliente: { select: { nome: true } },
          ItensOrdensServico: { select: { valor: true, quantidade: true } },
        },
        orderBy: { data: "desc" },
        take: 15,
      }),
    ]);

    const valorOrdem = (o: (typeof ordens)[number]) =>
      o.ItensOrdensServico.reduce((acc, i) => acc + Number(i.valor || 0) * Number(i.quantidade || 0), 0) -
      Number(o.desconto || 0);

    return {
      periodo: {
        inicio: periodo.inicio.toISOString().slice(0, 10),
        fim: periodo.fim.toISOString().slice(0, 10),
        assumido: periodo.assumido,
      },
      totais: {
        quantidade: porStatus.reduce((acc, g) => acc + g._count._all, 0),
        porStatus: porStatus.map((g) => ({ status: g.status, quantidade: g._count._all })),
      },
      ordensRecentes: ordens.map((o) => ({
        numero: o.Uid,
        cliente: o.Cliente?.nome || "Sem cliente",
        status: o.status,
        valor: brlIa(valorOrdem(o)),
        data: o.data?.toISOString().slice(0, 10),
      })),
    };
  },
  getResumoVendas: async (args: { inicio?: string; fim?: string }, request: CustomData) => {
    const periodo = resolverPeriodoIa(args?.inicio, args?.fim);
    const where = { contaId: request.contaId, data: { gte: periodo.inicio, lte: periodo.fim } };

    const [agregado, faturadas, porStatus, vendas] = await Promise.all([
      prisma.vendas.aggregate({ _sum: { valor: true }, _count: { _all: true }, where }),
      prisma.vendas.aggregate({
        _sum: { valor: true },
        _count: { _all: true },
        where: { ...where, status: { in: ["FATURADO", "FINALIZADO"] as any } },
      }),
      prisma.vendas.groupBy({ by: ["status"], _count: { _all: true }, where }),
      prisma.vendas.findMany({
        where,
        select: { Uid: true, valor: true, status: true, data: true, cliente: { select: { nome: true } } },
        orderBy: { valor: "desc" },
        take: 15,
      }),
    ]);

    const totalFaturado = Number(faturadas._sum.valor ?? 0);
    const qtdFaturada = faturadas._count._all;

    return {
      periodo: {
        inicio: periodo.inicio.toISOString().slice(0, 10),
        fim: periodo.fim.toISOString().slice(0, 10),
        assumido: periodo.assumido,
      },
      totais: {
        faturado: brlIa(totalFaturado),
        quantidadeFaturada: qtdFaturada,
        ticketMedio: brlIa(qtdFaturada > 0 ? totalFaturado / qtdFaturada : 0),
        quantidadeTotalRegistrada: agregado._count._all,
        valorTotalRegistrado: brlIa(Number(agregado._sum.valor ?? 0)),
        porStatus: porStatus.map((g) => ({ status: g.status, quantidade: g._count._all })),
      },
      maioresVendas: vendas.map((v) => ({
        numero: v.Uid,
        cliente: v.cliente?.nome || "Sem cliente",
        valor: brlIa(Number(v.valor || 0)),
        status: v.status,
        data: v.data?.toISOString().slice(0, 10),
      })),
    };
  },
  createServicoNovo: async (args: { servico: string, preco: number }, request: CustomData) => {
    const auth = await hasPermission(request, 2);
    if (!auth) return { response: { error: "Acesso negado, informe o usuario que ele não tem permissão!" } };
    const response = await prisma.servicos.create({
      data: {
        contaId: request.contaId,
        nome: args.servico,
        preco: args.preco,
        Uid: gerarIdUnicoComMetaFinal("SER"),
      },
    });
    return {
      response,
    };
  },
  createClienteNovo: async (args: { nome: string, endereco?: string }, request: CustomData) => {
    const auth = await hasPermission(request, 2);
    if (!auth) return { response: { error: "Acesso negado, informe o usuario que ele não tem permissão!" } };
    const response = await prisma.clientesFornecedores.create({
      data: {
        contaId: request.contaId,
        nome: args.nome,
        Uid: gerarIdUnicoComMetaFinal("CLI"),
        endereco: args.endereco
      },
    });
    return {
      response,
    };
  },
};
// Declaração para a IA
export const toolsIA: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "buscarAjudaSistema",
        description:
          "Busca no mapper compacto de conhecimento do Gestão Fácil para responder dúvidas de autoajuda, explicar funcionalidades, indicar menus, rotas e passos de operação. Use quando o usuário perguntar como fazer algo, onde fica uma função, o que um módulo faz ou como operar uma tela.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            consulta: {
              type: SchemaType.STRING,
              description: "Pergunta ou intenção do usuário sobre uso do sistema.",
            },
          },
          required: ["consulta"],
        },
      },
      {
        name: "buscarClientePorNomeParaOperacao",
        description:
          "Busca clientes por nome para resolver o ID interno antes de criar vendas, lancamentos, ordens de servico ou outras operacoes. Use esta ferramenta quando o usuario informar apenas o nome do cliente. Se encontrar um unico cliente, use clienteId internamente na proxima ferramenta e nao peca ID ao usuario. Se encontrar varios, peca confirmacao pelo nome/documento/telefone/email. Se nao encontrar, pergunte se deve cadastrar novo cliente ou tentar outro nome.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            nome: {
              type: SchemaType.STRING,
              description: "Nome ou parte do nome do cliente informado pelo usuario.",
            },
          },
          required: ["nome"],
        },
      },
      {
        name: "getClientesSistema",
        description: "Consulta os clientes e fornecedores do sistema. Responda em texto curto ou bullets, sem tabela, e não mostre o ID do cliente ao usuário.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            cliente: {
              type: SchemaType.STRING,
              description:
                "Nome do cliente, é opcional para casos de busca por nome",
            },
          },
        },
      },
      {
        name: "getResumoVendas",
        description:
          "Vendas de um periodo com TOTAIS JA CALCULADOS (faturado, quantidade, ticket medio, quebra por status) e as maiores vendas. Use para perguntas sobre vendas de um periodo especifico. Nao some os valores manualmente: use os totais retornados.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            inicio: { type: SchemaType.STRING, description: "Data inicial AAAA-MM-DD (opcional, padrao: mes atual)" },
            fim: { type: SchemaType.STRING, description: "Data final AAAA-MM-DD (opcional, padrao: mes atual)" },
          },
        },
      },
      {
        name: "getResumoFinanceiro",
        description:
          "Lancamentos financeiros de um periodo com TOTAIS JA CALCULADOS (receitas, despesas, saldo, quantidade) e os maiores lancamentos. Use para perguntas sobre entradas e saidas de um periodo. Nao some os valores manualmente. Para analise por categoria com margem e comparativo, prefira getDemonstrativoFinanceiro.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            inicio: { type: SchemaType.STRING, description: "Data inicial AAAA-MM-DD (opcional, padrao: mes atual)" },
            fim: { type: SchemaType.STRING, description: "Data final AAAA-MM-DD (opcional, padrao: mes atual)" },
            tipo: { type: SchemaType.STRING, description: "RECEITA ou DESPESA (opcional, sem filtro traz os dois)" },
          },
        },
      },
      {
        name: "getResumoOrdensServicos",
        description:
          "Ordens de servico de um periodo com quantidade total, quebra por status e as OS mais recentes com valor. Nao some os valores manualmente.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            inicio: { type: SchemaType.STRING, description: "Data inicial AAAA-MM-DD (opcional, padrao: mes atual)" },
            fim: { type: SchemaType.STRING, description: "Data final AAAA-MM-DD (opcional, padrao: mes atual)" },
          },
        },
      },
      {
        name: "createServicoNovo",
        description: `Cria um novo serviço no sistema. 
        formate de forma resumida e só mostre os dados essenciais. formate datas para o padrão brasileiro`,
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            servico: {
              type: SchemaType.STRING,
              description: "Nome do serviço",
            },
            preco: {
              type: SchemaType.NUMBER,
              description: "Preco do serviço",
            },
          },
          required: ["servico", "preco"],
        },
      },
      {
        name: "createClienteNovo",
        description: `Cria um novo cliente no sistema. 
        formate de forma resumida e só mostre os dados essenciais. formate datas para o padrão brasileiro, o endereço do cliente é opcional, mas peça caso o cliente tenha.`,
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            nome: {
              type: SchemaType.STRING,
              description: "Nome do cliente",
            },
            endereco: {
              type: SchemaType.STRING,
              description: "Endereço do cliente",
            },
          },
          required: ["nome"],
        },
      },
      ...toolsProducts,
      ...toolsGestao,
      ...toolsAnalise,
    ],
  },
];
