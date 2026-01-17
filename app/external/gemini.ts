import { SchemaType, Tool } from "@google/generative-ai";
import { prisma } from "../utils/prisma";

// Funções reais do seu sistema
export const systemFunctionsIA = {
  getProdutosSistema: async (args: { product: string }, accountId: number) => {
    const produtos = await prisma.produto.findMany({
      where: {
        contaId: accountId,
        nome: {
          contains: args.product
        }
      },
      select: {
        id: true,
        nome: true,
        estoque: true,
        minimo: true,
        preco: true
      }
    });
    return { 
      produtos
    };
  },
  getClientesSistema: async (args: { cliente: string }, accountId: number) => {
    const response = await prisma.clientesFornecedores.findMany({
      where: {
        contaId: accountId,
        nome: {
          contains: args.cliente
        }
      },
      select: {
        id: true,
        nome: true,
        status: true,
        documento: true,
        telefone: true
      }
    });
    return { 
      response
    };
  },
  
  generateDiscountCode: async (args: { percentage: number }, accountId: number) => {
    const code = `PROMO${args.percentage}-${Math.random().toString(36).toUpperCase().substring(7)}`;
    return { code, validUntil: "2024-12-31" };
  }
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
            product: { type: SchemaType.STRING, description: "Nome do produto, é opcional para casos de busca por nome" },
          }
        }
      },
      {
        name: "getClientesSistema",
        description: "Consulta os clientes e fornecedores do sistema",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            cliente: { type: SchemaType.STRING, description: "Nome do cliente, é opcional para casos de busca por nome" },
          }
        }
      },
      {
        name: "generateDiscountCode",
        description: "Gera um cupom de desconto para o cliente",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            percentage: { type: SchemaType.NUMBER, description: "Porcentagem do desconto (ex: 10, 20), não pode ser maior que 20" },
          },
          required: ["percentage"],
        },
      }
    ],
  },
];