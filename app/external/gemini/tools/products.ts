import { FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { prisma } from "../../../utils/prisma";
import { hasPermission } from "../../../helpers/userPermission";
import { gerarIdUnicoComMetaFinal } from "../../../helpers/generateUUID";
import { CustomData } from "../../../helpers/getCustomRequest";

// Normaliza um texto para compor um SKU (sem acentos, só alfanumérico, maiúsculo).
function normalizarParteSku(texto: string, max: number): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, max);
}

// Gera um SKU único para a conta (mesmo padrão do cadastro normal de produtos).
async function gerarSkuUnicoTool(tx: any, contaId: number, nome: string): Promise<string> {
  const prefixo = normalizarParteSku(nome, 6) || "SKU";
  for (let i = 0; i < 25; i++) {
    const sufixo = Math.random().toString(36).slice(2, 6).toUpperCase();
    const codigo = `${prefixo}-${sufixo}`;
    const existente = await tx.produto.findFirst({ where: { contaId, codigo }, select: { id: true } });
    if (!existente) return codigo;
  }
  return `${prefixo}-${Date.now().toString(36).toUpperCase()}`;
}

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
    const product = String(args?.product || "").trim();
    const produtos = await prisma.produto.findMany({
      where: {
        contaId: request.contaId,
        ...(product ? { nome: { contains: product } } : {}),
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
      orderBy: { nome: "asc" },
      take: 20,
    });
    return { produtos, totalRetornado: produtos.length };
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

    // Validação básica dos argumentos vindos da IA.
    const nome = String(args.nome || "").trim();
    if (!nome) return { response: { error: "Informe o nome do produto." } };
    const preco = Number(args.preco);
    if (!Number.isFinite(preco) || preco < 0) {
      return { response: { error: "Informe um preço válido (maior ou igual a zero)." } };
    }
    const estoque = Math.max(0, Math.round(Number(args.estoque) || 0));
    const minimo = Math.max(0, Math.round(Number(args.minimo) || 0));

    // Todo produto é uma variante de um ProdutoBase. Criamos os dois numa transação (mesmo
    // fluxo do cadastro normal), senão a variante fica órfã e quebra a listagem de produtos.
    const response = await prisma.$transaction(async (tx) => {
      const base = await tx.produtoBase.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("PB"),
          contaId: request.contaId,
          nome,
        },
      });

      const codigo = await gerarSkuUnicoTool(tx, request.contaId, nome);

      return tx.produto.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("PRO"),
          contaId: request.contaId,
          produtoBaseId: base.id,
          nome,
          nomeVariante: "Padrão",
          ehPadrao: true,
          preco,
          estoque,
          minimo,
          codigo,
          unidade: "un",
          controlaEstoque: true,
          entradas: true,
          saidas: true,
        },
        select: { id: true, nome: true, preco: true, estoque: true, minimo: true, codigo: true },
      });
    });

    return { response: { ...response, mensagem: "Produto criado com sucesso." } };
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
    // Garante que o produto é da conta antes de mexer no estoque.
    const produto = await prisma.produto.findFirst({
      where: { id: args.idProduto, contaId: request.contaId },
      select: { id: true },
    });
    if (!produto) {
      return { response: { error: "Produto não encontrado para esta conta." } };
    }
    if (!Number.isFinite(args.quantidade) || args.quantidade <= 0) {
      return { response: { error: "Informe uma quantidade maior que zero." } };
    }

    // Incremento de estoque + registro da movimentação numa transação (consistência).
    const [response, reposicao] = await prisma.$transaction([
      prisma.produto.update({
        where: { id: args.idProduto },
        data: { estoque: { increment: args.quantidade } },
      }),
      prisma.movimentacoesEstoque.create({
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
      }),
    ]);
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
      "Consulta os produtos do sistema. Peça o nome apenas se o usuário quiser um produto específico. Responda em texto curto ou bullets, sem tabela, e não mostre o ID do produto ao usuário.",
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
