import { SchemaType, Tool } from "@google/generative-ai";
import { prisma } from "../../utils/prisma";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { CustomData } from "../../helpers/getCustomRequest";
import { hasPermission } from "../../helpers/userPermission";
import { systemFunctionsProdutosIA, toolsProducts } from "./tools/products";

// Funções reais do seu sistema
export const systemFunctionsIA = {
  ...systemFunctionsProdutosIA,
  getClientesSistema: async (args: { cliente: string }, request: CustomData) => {
    const response = await prisma.clientesFornecedores.findMany({
      where: {
        contaId: request.contaId,
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
  getResumoFinanceiro: async (args: any, request: CustomData) => {
    const auth = await hasPermission(request, 3);
    if (!auth) return { response: { error: "Acesso negado, informe o usuario que ele não tem permissão!" } };
    const response = await prisma.lancamentoFinanceiro.findMany({
      where: {
        contaId: request.contaId,
      },
      include: {
        parcelas: true,
      }
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
      }
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
        name: "getClientesSistema",
        description: "Consulta os clientes e fornecedores do sistema, retorne em formato de tabela, não mostre o ID do cliente ao usuario.",
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
        formate de forma resumida e só mostre os dados essenciais. formate datas para o padrão brasileiro e mostre em tabela`,
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
      ...toolsProducts
    ],
  },
];
