import { z } from "zod";

const parseNullableText = z.preprocess((value) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return String(value);
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}, z.string().nullable());

const parseRequiredText = (field: string, min = 1) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z
      .string({
        required_error: `${field} é obrigatório`,
        invalid_type_error: `${field} deve ser uma string`,
      })
      .min(min, `${field} deve ter pelo menos ${min} caractere(s)`)
  );

const parseOptionalText = (field: string) =>
  z.preprocess((value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return String(value);
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }, z.string({ invalid_type_error: `${field} deve ser uma string` }).optional());

const parseDecimal = (field: string, required = false) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return required ? value : undefined;
    }
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const normalized = value.trim().replace(/[^\d,.-]/g, "");
      if (!normalized) return required ? value : undefined;
      if (normalized.includes(",") && normalized.includes(".")) {
        return Number(normalized.replace(/\./g, "").replace(",", "."));
      }
      return Number(normalized.replace(",", "."));
    }
    return Number(value);
  },
  required
    ? z
        .number({
          required_error: `${field} é obrigatório`,
          invalid_type_error: `${field} deve ser um número`,
        })
        .finite(`${field} inválido`)
    : z
        .number({
          invalid_type_error: `${field} deve ser um número`,
        })
        .finite(`${field} inválido`)
        .optional());

const parseInteger = (field: string, required = false, min = 0) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return required ? value : undefined;
    }
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(value.trim().replace(",", "."));
    return Number(value);
  },
  required
    ? z
        .number({
          required_error: `${field} é obrigatório`,
          invalid_type_error: `${field} deve ser um número`,
        })
        .int(`${field} deve ser inteiro`)
        .min(min, `${field} deve ser maior ou igual a ${min}`)
    : z
        .number({
          invalid_type_error: `${field} deve ser um número`,
        })
        .int(`${field} deve ser inteiro`)
        .min(min, `${field} deve ser maior ou igual a ${min}`)
        .optional());

const parseBoolean = (field: string, defaultValue?: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return defaultValue;
    }
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "sim", "on"].includes(normalized)) return true;
      if (["false", "0", "nao", "não", "off"].includes(normalized)) return false;
    }
    return value;
  },
  z.boolean({
    required_error: `${field} é obrigatório`,
    invalid_type_error: `${field} deve ser um booleano`,
  }));

export const ProdutoSchema = z.object({
  id: parseInteger("id").optional(),
  categoriaId: z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(value.trim());
    return Number(value);
  }, z.number({ invalid_type_error: "categoriaId deve ser um número" }).int().nullable().optional()),
  contaId: z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(value.trim());
    return Number(value);
  }, z.number({ invalid_type_error: "contaId deve ser um número" }).int().optional()),
  nome: parseRequiredText("nome", 2),
  nomeVariante: z
    .preprocess(
      (value) => {
        if (value === undefined || value === null || value === "") return "Padrão";
        if (typeof value !== "string") return String(value);
        return value.trim();
      },
      z.string({
        invalid_type_error: "nomeVariante deve ser uma string",
      })
    )
    .optional(),
  descricao: parseNullableText.optional(),
  preco: parseDecimal("preco", true),
  estoque: parseInteger("estoque", true, 0),
  minimo: parseInteger("minimo", true, 0),
  precoCompra: parseDecimal("precoCompra").optional(),
  unidade: parseOptionalText("unidade"),
  codigo: parseOptionalText("codigo"),
  entradas: parseBoolean("entradas", true),
  saidas: parseBoolean("saidas", true),
  producaoLocal: parseBoolean("produção local", false).optional().nullable(),
  custoMedioProducao: parseDecimal("custoMedioProducao").optional().nullable(),
  controlaEstoque: parseBoolean("controlaEstoque", true).optional().nullable(),
});

export const ProdutoCategoriaSchema = z.object({
  id: parseInteger("id").optional(),
  nome: parseRequiredText("nome", 2),
  status: z
    .enum(["ATIVO", "INATIVO", "BLOQUEADO"], {
      invalid_type_error: "status inválido",
    })
    .default("ATIVO")
    .optional(),
});

export const ReposicaoEstoqueSchema = z.object({
  produtoId: parseInteger("produtoId", true, 1),
  quantidade: parseInteger("quantidade", true, 1),
  custo: parseDecimal("custo", true),
  desconto: parseDecimal("desconto").nullable().optional(),
  frete: parseDecimal("frete").nullable().optional(),
  notaFiscal: parseNullableText.optional(),
  fornecedor: z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(value.trim());
    return Number(value);
  }, z.number({ invalid_type_error: "fornecedor deve ser um número" }).int().nullable().optional()),
});
