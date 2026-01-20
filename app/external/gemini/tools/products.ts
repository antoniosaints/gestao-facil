import { FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { prisma } from "../../../utils/prisma";
import { hasPermission } from "../../../helpers/userPermission";
import { gerarIdUnicoComMetaFinal } from "../../../helpers/generateUUID";
import { CustomData } from "../../../helpers/getCustomRequest";

export const systemFunctionsProdutosIA = {
  getProdutosSistema: async (
    args: { product: string },
    request: CustomData,
  ) => {
    const auth = await hasPermission(request, 3);
    if (!auth)
      return {
        response: {
          error: "Acesso negado, informe o usuario que ele não tem permissão!",
        },
      };
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
  getProdutoReposicao: async (
    args: { produto: string },
    request: CustomData,
  ) => {
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
  createProdutoNovo: async (
    args: { nome: string; preco: number; estoque: number; minimo: number },
    request: CustomData,
  ) => {
    const auth = await hasPermission(request, 3);
    if (!auth)
      return {
        response: {
          error: "Acesso negado, informe o usuario que ele não tem permissão!",
        },
      };
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
  createReposicaoEstoqueProduto: async (
    args: {
      idProduto: number;
      quantidade: number;
      valor?: number;
      nota?: string;
    },
    request: CustomData,
  ) => {
    const auth = await hasPermission(request, 4);
    if (!auth)
      return {
        response: {
          error: "Acesso negado, informe o usuario que ele não tem permissão!",
        },
      };
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
    });
    return {
      response,
      reposicao,
    };
  },
};

export const toolsProducts: FunctionDeclaration[] = [
  {
    name: "getProdutosSistema",
    description:
      "Consulta os produtos do sistema, peça o nome apenas se o usuario quiser um produto especifico, retorne em formato de tabela, não mostre o ID do produto ao usuario.",
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
    },
  },
  {
    name: "createReposicaoEstoqueProduto",
    description: `Após realizar a busca do produto no sistema, peça ao usuario qual produto ele deseja repor estoque, 
        essa função deve ser chamada apenas quando tiver o ID do produto para repor, que vem da função getProdutoReposicao, 
        o valor e nota fiscal são opcionais, peça ao usuario caso ele tenha essas informações, se não tiver, pode realizar o cadastro, 
        não mostre o ID para o usuario, ele não precisa saber isso.`,
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
          description: "Número da Nota fiscal",
        },
      },
      required: ["idProduto", "quantidade"],
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
];
