import { SchemaType, Tool } from "@google/generative-ai";
import { prisma } from "../../utils/prisma";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { CustomData } from "../../helpers/getCustomRequest";
import { hasPermission } from "../../helpers/userPermission";
import { systemFunctionsProdutosIA, toolsProducts } from "./tools/products";
import { systemFunctionsGestaoIA, toolsGestao } from "./tools/gestao";
import { buscarAjudaSistemaParaIa } from "../../services/ia/coreIaKnowledgeMapper";

// Funções reais do seu sistema
export const systemFunctionsIA = {
  ...systemFunctionsProdutosIA,
  ...systemFunctionsGestaoIA,
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
  getResumoFinanceiro: async (args: any, request: CustomData) => {
    const auth = await hasPermission(request, 3);
    if (!auth) return { response: { error: "Acesso negado, informe o usuario que ele não tem permissão!" } };
    const response = await prisma.lancamentoFinanceiro.findMany({
      where: {
        contaId: request.contaId,
      },
      include: {
        parcelas: true,
      },
      orderBy: { dataLancamento: "desc" },
      take: 50,
    });

    return {
      response,
    };
  },
  getResumoOrdensServicos: async (args: any, request: CustomData) => {
    const response = await prisma.ordensServico.findMany({
      where: {
        contaId: request.contaId,
      },
      include: {
        Cliente: {
          select: {
            nome: true,
          },
        },
        ItensOrdensServico: true,
      },
      orderBy: { data: "desc" },
      take: 50,
    });

    return {
      response,
    };
  },
  getResumoVendas: async (args: any, request: CustomData) => {
    const response = await prisma.vendas.findMany({
      where: {
        contaId: request.contaId,
      },
      include: {
        cliente: {
          select: {
            nome: true,
          },
        },
      },
      orderBy: { data: "desc" },
      take: 50,
    });

    return {
      response,
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
        description: `Busca as vendas do sistema e cria um relatorio de vendas com base nos dados recuperados. 
        formate de forma resumida, sem tabela, e só mostre os dados essenciais. formate datas para o padrão brasileiro`,
      },
      {
        name: "getResumoFinanceiro",
        description: `Busca os lançamentos do sistema e cria um relatorio de financeiro com base nos dados recuperados. 
        formate de forma resumida e só mostre os dados essenciais. formate datas para o padrão brasileiro`,
      },
      {
        name: "getResumoOrdensServicos",
        description: `Busca as ordens de serviços do sistema e cria um relatorio de ordens de serviços com base nos dados recuperados. 
        formate de forma resumida e só mostre os dados essenciais. formate datas para o padrão brasileiro`,
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
    ],
  },
];
