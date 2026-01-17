import { SchemaType, Tool } from "@google/generative-ai";

// Funções reais do seu sistema
export const systemFunctionsIA = {
  getInventory: async (args: { product: string }) => {
    console.log(`[Sistema] Verificando estoque de: ${args.product}`);
    // Simulação de banco de dados
    const stock: Record<string, number> = { "iphone": 5, "macbook": 2, "ipad": 0 };
    return { 
      product: args.product, 
      quantity: stock[args.product.toLowerCase()] ?? 0 
    };
  },
  
  generateDiscountCode: async (args: { percentage: number }) => {
    const code = `PROMO${args.percentage}-${Math.random().toString(36).toUpperCase().substring(7)}`;
    return { code, validUntil: "2024-12-31" };
  }
};

// Declaração para a IA
export const toolsIA: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "getInventory",
        description: "Consulta o estoque de um produto no armazém",
        parameters: {
          type: SchemaType.OBJECT,
          description: "Objeto com o nome do produto",
          properties: {
            product: { type: SchemaType.STRING, description: "Nome do produto" },
          },
          required: ["product"],
        },
      },
      {
        name: "generateDiscountCode",
        description: "Gera um cupom de desconto para o cliente",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            percentage: { type: SchemaType.NUMBER, description: "Porcentagem do desconto (ex: 10, 20)" },
          },
          required: ["percentage"],
        },
      }
    ],
  },
];