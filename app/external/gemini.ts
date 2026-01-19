import { SchemaType, Tool } from "@google/generative-ai";
import { prisma } from "../utils/prisma";
import { gerarIdUnicoComMetaFinal } from "../helpers/generateUUID";

// Funções reais do seu sistema
export const systemFunctionsIA = {
  getProdutosSistema: async (args: { product: string }, accountId: number) => {
    const produtos = await prisma.produto.findMany({
      where: {
        contaId: accountId,
        nome: {
          contains: args.product,
        },
      },
      select: {
        id: true,
        nome: true,
        estoque: true,
        minimo: true,
        preco: true,
      },
    });
    return {
      produtos,
    };
  },
  getClientesSistema: async (args: { cliente: string }, accountId: number) => {
    const response = await prisma.clientesFornecedores.findMany({
      where: {
        contaId: accountId,
        nome: {
          contains: args.cliente,
        },
      },
      select: {
        id: true,
        nome: true,
        status: true,
        documento: true,
        endereco: true,
        email: true,
        Vendas: true,
        telefone: true,
      },
    });
    return {
      response,
    };
  },
  getResumoFinanceiro: async (args: any, accountId: number) => {
    const response = await prisma.lancamentoFinanceiro.findMany({
      where: {
        contaId: accountId,
      },
      include: {
        parcelas: true,
      }
    });

    return {
      response,
    };
  },
  getResumoOrdensServicos: async (args: any, accountId: number) => {
    const servicos = await prisma.servicos.findMany({
      where: {
        contaId: accountId,
      },
    });
    const response = await prisma.ordensServico.findMany({
      where: {
        contaId: accountId,
      },
      include: {
        Cliente: {
          select: {
            nome: true,
          },
        },
        ItensOrdensServico: true,
      }
    });

    return {
      response,
      servicos,
    };
  },
  getResumoVendas: async (args: any, accountId: number) => {
    const response = await prisma.vendas.findMany({
      where: {
        contaId: accountId,
      },
      include: {
        cliente: {
          select: {
            nome: true,
          },
        },
      },
    });

    return {
      response,
    };
  },
  createServicoNovo: async (args: { servico: string, preco: number }, accountId: number) => {
    const response = await prisma.servicos.create({
      data: {
        contaId: accountId,
        nome: args.servico,
        preco: args.preco,
        Uid: gerarIdUnicoComMetaFinal("SER"),
      },
    });
    return {
      response,
    };
  },
  createClienteNovo: async (args: { nome: string, endereco?: string }, accountId: number) => {
    const response = await prisma.clientesFornecedores.create({
      data: {
        contaId: accountId,
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
        name: "getProdutosSistema",
        description: "Consulta os produtos do sistema, peça o nome apenas se o usuario quiser um produto especifico.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            product: {
              type: SchemaType.STRING,
              description:
                "Nome do produto, é opcional para casos de busca por nome",
            },
          },
        },
      },
      {
        name: "getClientesSistema",
        description: "Consulta os clientes e fornecedores do sistema",
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
        formate de forma resumida e só mostre os dados essenciais. formate datas para o padrão brasileiro`,
      },
      {
        name: "getResumoFinanceiro",
        description: `Busca os lançamentos do sistema e cria um relatorio de financeiro com base nos dados recuperados. 
        formate de forma resumida e só mostre os dados essenciais. formate datas para o padrão brasileiro`,
      },
      {
        name: "getResumoOrdensServicos",
        description: `Busca as ordens de serviços do sistema e cria um relatorio de ordens de serviços com base nos dados recuperados. 
        formate de forma resumida e só mostre os dados essenciais. formate datas para o padrão brasileiro, só retorne a lista de serviços se o cliente
        pedir, caso contrario, retorne apenas o resumo das OS.`,
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
    ],
  },
];
