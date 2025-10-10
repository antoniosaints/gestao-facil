import { z } from "zod";
export const updateParametrosContaSchema = z.object(
  {
    AsaasApiKey: z
      .string({
        invalid_type_error: "O campo AsaasApiKey deve ser uma string",
      })
      .optional()
      .nullable(),
    AsaasApiSecret: z
      .string({
        invalid_type_error: "O campo AsaasApiSecret deve ser uma string",
      })
      .optional()
      .nullable(),
    AsaasEnv: z
      .string({
        invalid_type_error: "O campo AsaasEnv deve ser uma string",
      })
      .optional()
      .nullable(),
    emailAvisos: z
      .string({
        invalid_type_error: "O campo AsaasEnv deve ser uma string",
      })
      .optional()
      .nullable(),
    eventoEstoqueBaixo: z
      .boolean({
        invalid_type_error: "O campo eventoEstoqueBaixo deve ser um booleano",
      })
      .optional()
      .nullable(),
    eventoSangria: z
      .boolean({
        invalid_type_error: "O campo eventoSangria deve ser um booleano",
      })
      .optional()
      .nullable(),
    eventoVendaConcluida: z
      .boolean({
        invalid_type_error: "O campo eventoVendaConcluida deve ser um booleano",
      })
      .optional()
      .nullable(),
    MercadoPagoApiKey: z
      .string({
        invalid_type_error: "O campo MercadoPagoApiKey deve ser uma string",
      })
      .optional()
      .nullable(),
    MercadoPagoEnv: z
      .string({
        invalid_type_error: "O campo MercadoPagoEnv deve ser uma string",
      })
      .optional()
      .nullable(),
  },
  {
    required_error: "Informe os parâmetros da conta",
    invalid_type_error:
      "A requisição espera um objeto JSON com os parâmetros a serem atualizados",
  }
);
export const updateContaSchema = z.object(
  {
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
  },
  {
    required_error: "Informe os dados da conta",
    invalid_type_error:
      "A requisição espera um objeto JSON com os dados a serem atualizados",
  }
);
