import { SchemaType, Tool } from "@google/generative-ai";
import { prisma } from "../utils/prisma";
import { gerarIdUnicoComMetaFinal } from "../helpers/generateUUID";
import { CustomData } from "../helpers/getCustomRequest";
import { hasPermission } from "../helpers/userPermission";

// Funções reais do seu sistema
export const systemFunctionsIA = {
  getProdutosSistema: async (args: { product: string }, request: CustomData) => {
    const auth = await hasPermission(request, 3);
    if (!auth) return { response: { error: "Acesso negado, informe o usuario que ele não tem permissão!" } };
    const produtos = await prisma.produto.findMany({
      where: {
        contaId: request.contaId,
        nome: {
          contains: args.product,
        },
      },
      select: {
        id: true,
        Uid: true,
        nome: true,
        estoque: true,
        minimo: true,
        preco: true,
        codigo: true,
      },
    });
    return {
      produtos,
    };
  },
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
  getProdutoReposicao: async (args: { produto: string }, request: CustomData) => {
    const response = await prisma.produto.findMany({
      where: {
        contaId: request.contaId,
        nome: {
          contains: args.produto,
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
  createProdutoNovo: async (args: { nome: string, preco: number, estoque: number, minimo: number }, request: CustomData) => {
    const auth = await hasPermission(request, 3);
    if (!auth) return { response: { error: "Acesso negado, informe o usuario que ele não tem permissão!" } };
    const response = await prisma.produto.create({
      data: {
        contaId: request.contaId,
        nome: args.nome,
        estoque: args.estoque,
        minimo: args.minimo,
        preco: args.preco,
        entradas: true,
        saidas: true,
        controlaEstoque: true,
        unidade: "un",
        Uid: gerarIdUnicoComMetaFinal("PRO"),
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
  createReposicaoEstoqueProduto: async (args: { idProduto: number, quantidade: number, valor?: number, nota?: string }, request: CustomData) => {
    const auth = await hasPermission(request, 4);
    if (!auth) return { response: { error: "Acesso negado, informe o usuario que ele não tem permissão!" } };
    const response = await prisma.produto.update({
      where: {
        contaId: request.contaId,
        id: args.idProduto,
      },
      data: {
        estoque: {
          increment: args.quantidade,
        },
      },
    });

    const reposicao = await prisma.movimentacoesEstoque.create({
      data: {
        contaId: request.contaId,
        produtoId: args.idProduto,
        tipo: "ENTRADA",
        status: "CONCLUIDO",
        quantidade: args.quantidade,
        data: new Date(),
        notaFiscal: args.nota,
        custo: args.valor || 0,
      },
    })
    return {
      response,
      reposicao
    };
  },
};
// Declaração para a IA
export const toolsIA: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "getProdutosSistema",
        description: "Consulta os produtos do sistema, peça o nome apenas se o usuario quiser um produto especifico, retorne em formato de tabela, não mostre o ID do produto ao usuario.",
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
        name: "getProdutoReposicao",
        description: `Busca um produto do sistema pelo nome para que possa ser usado o ID dele na funcao de reposicao de estoque, 
        caso tenha mais de um resultado, confirmar com o usuario qual produto é o correto.`,
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            produto: {
              type: SchemaType.STRING,
              description: "Nome do produto",
            },
          },
          required: ["produto"],
        }
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
        name: "createReposicaoEstoqueProduto",
        description: `Após realizar a busca do produto no sistema, peça ao usuario qual produto ele deseja repor estoque, 
        essa função deve ser chamada apenas quando tiver o ID do produto para repor, que vem da função getProdutoReposicao, 
        o valor e nota fiscal são opcionais, peça ao usuario caso ele tenha essas informações, se não tiver, pode realizar o cadastro`,
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            idProduto: {
              type: SchemaType.NUMBER,
              description: "ID do produto",
            },
            quantidade: {
              type: SchemaType.NUMBER,
              description: "Quantidade de produtos para serem repostos",
            },
            valor: {
              type: SchemaType.NUMBER,
              description: "Valor por unidade reposta",
            },
            nota: {
              type: SchemaType.STRING,
              description: "Nota fiscal",
            },
          },
          required: ["idProduto", "quantidade"],
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
      {
        name: "createProdutoNovo",
        description: `Cria um novo produto no sistema, essa função deve ser chamada e os campos devem ser listados para o usuario saber o que deve informar, sempre confirmar os dados antes de registrar.`,
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            nome: {
              type: SchemaType.STRING,
              description: "Nome do produto",
            },
            estoque: {
              type: SchemaType.NUMBER,
              description: "Estoque atual do produto",
            },
            minimo: {
              type: SchemaType.NUMBER,
              description: "Estoque minimo do produto",
            },
            preco: {
              type: SchemaType.NUMBER,
              description: "Preco do produto",
            },
          },
          required: ["nome", "estoque", "minimo", "preco"],
        },
      },
    ],
  },
];
