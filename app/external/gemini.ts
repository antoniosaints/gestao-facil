import { SchemaType, Tool } from "@google/generative-ai";
import { prisma } from "../utils/prisma";

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
        telefone: true,
      },
    });
    return {
      response,
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
};

// Declaração para a IA
export const toolsIA: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "getProdutosSistema",
        description: "Consulta os produtos do sistema",
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
    ],
  },
];
