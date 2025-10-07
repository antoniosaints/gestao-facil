import { z } from "zod";

export const updateContaSchema = z.object({
  nome: z.string({
    invalid_type_error: "O campo nome deve ser uma string",
    required_error: "O campo nome é obrigatório",
  }),
  tipo: z.string({
    invalid_type_error: "O campo tipo deve ser uma string",
    required_error: "O campo tipo é obrigatório",
  }),
  documento: z.string({
    invalid_type_error: "O campo documento deve ser uma string",
    required_error: "O campo documento é obrigatório",
  }),
  telefone: z
    .string({
      invalid_type_error: "O campo telefone deve ser uma string",
    })
    .optional()
    .nullable(),
  dicasNovidades: z
    .boolean({
      invalid_type_error: "O campo dicasNovidades deve ser um booleano",
    })
    .optional()
    .nullable(),
  endereco: z
    .string({
      invalid_type_error: "O campo endereco deve ser uma string",
    })
    .optional()
    .nullable(),
  nomeFantasia: z
    .string({
      invalid_type_error: "O campo nomeFantasia deve ser uma string",
    })
    .optional()
    .nullable(),
  cep: z
    .string({
      invalid_type_error: "O campo cep deve ser uma string",
    })
    .optional()
    .nullable(),
  emailAvisos: z
    .string({
      invalid_type_error: "O campo emailAvisos deve ser uma string",
    })
    .optional()
    .nullable(),
}, {
  required_error: "Informe os dados da conta",
  invalid_type_error: "A requisição espera um objeto JSON com os dados a serem atualizados",
});
