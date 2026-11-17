import { SchemaType, type FunctionDeclaration } from "@google/generative-ai";
import type { CustomData } from "../../../helpers/getCustomRequest";
import { criarVendaInternal } from "../../../services/vendas/vendaCriacaoService";
import { vendaSchema } from "../../../schemas/vendas";
import { prisma } from "../../../utils/prisma";

export const systemFunctionsVendasIA = {
  getServicosSistema: async (args: { nome?: string }, request: CustomData) => ({
    servicos: await prisma.servicos.findMany({
      where: {
        contaId: request.contaId,
        ...(args.nome ? { nome: { contains: args.nome } } : {}),
      },
      select: { id: true, nome: true, preco: true },
      take: 20,
      orderBy: { nome: "asc" },
    }),
  }),
  // Receives only server-resolved and reviewed sale payloads, never raw LLM arguments.
  createVendaNova: async (args: unknown, request: CustomData) => {
    const data = vendaSchema.parse(args);
    const response = await criarVendaInternal(data, request);
    return {
      response: {
        numero: response.Uid,
        valor: response.valor,
        status: response.status,
      },
    };
  },
};
export const toolsVendas: FunctionDeclaration[] = [
  {
    name: "getServicosSistema",
    description:
      "Consulta o catálogo de serviços por nome para cadastro de venda; não confundir com ordens de serviço.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: { nome: { type: SchemaType.STRING } },
    },
  },
  {
    name: "createVendaNova",
    description:
      "Prepara uma venda de produtos e/ou serviços existentes para revisão. Resolve nomes no catálogo; se houver ambiguidade, pede escolha. Cria venda FINALIZADO com pagamento PENDENTE, baixa estoque como o formulário normal; faturamento e recebimento são etapas separadas no ERP. Não emite documento fiscal. Não invente nomes, quantidades ou preços. Preço omitido usa o catálogo.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        clienteId: {
          type: SchemaType.NUMBER,
          description:
            "ID interno do cliente obtido em consulta autorizada, para desambiguar nomes iguais. Nunca invente nem peça IDs ao usuário.",
        },
        cliente: {
          type: SchemaType.STRING,
          description:
            "Nome do cliente existente; omitido = consumidor não identificado",
        },
        itens: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              id: {
                type: SchemaType.NUMBER,
                description:
                  "ID interno do item obtido no catálogo, quando necessário para desambiguar.",
              },
              nome: { type: SchemaType.STRING },
              tipo: {
                type: SchemaType.STRING,
                format: "enum",
                enum: ["PRODUTO", "SERVICO"],
              },
              quantidade: {
                type: SchemaType.NUMBER,
                description:
                  "Quantidade inteira positiva, conforme os itens de venda do ERP atual",
              },
              preco: {
                type: SchemaType.NUMBER,
                description:
                  "Preço unitário negociado, somente se informado; omitido usa catálogo",
              },
            },
            required: ["nome", "tipo", "quantidade"],
          },
        },
        desconto: {
          type: SchemaType.NUMBER,
          description: "Desconto total em reais",
        },
        data: {
          type: SchemaType.STRING,
          description: "AAAA-MM-DD, padrão hoje",
        },
        pagamento: {
          type: SchemaType.STRING,
          description:
            "PIX, DINHEIRO, CARTAO, TRANSFERENCIA, CHEQUE, CREDITO, DEBITO, BOLETO ou OUTRO. Não significa pagamento recebido.",
        },
        observacoes: { type: SchemaType.STRING },
      },
      required: ["itens"],
    },
  },
];
