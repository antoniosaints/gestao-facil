import { z } from "zod";

export const createReservaPublicoSchema = z.object(
  {
    clienteId: z
      .number({
        invalid_type_error: "O campo clienteId deve ser um numero",
      })
      .int()
      .nullable()
      .optional(),
    quadraId: z
      .number({
        required_error: "O campo quadraId é obrigatório",
        invalid_type_error: "O campo quadraId deve ser um numero",
      })
      .int(),
    contaId: z
      .number({
        required_error: "O campo contaId é obrigatório",
        invalid_type_error: "O campo contaId deve ser um numero",
      })
      .int(),
    inicio: z
      .string({
        required_error: "O campo inicio é obrigatório",
        invalid_type_error:
          "O campo inicio deve ser uma string no formato YYYY-MM-DDTHH:MM:SS",
      })
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
        "O campo inicio deve estar no formato YYYY-MM-DDTHH:MM:SS"
      ),

    fim: z
      .string({
        required_error: "O campo fim é obrigatório",
        invalid_type_error:
          "O campo fim deve ser uma string no formato YYYY-MM-DDTHH:MM:SS",
      })
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
        "O campo fim deve estar no formato YYYY-MM-DDTHH:MM:SS"
      ),
    observacoes: z.string().max(500).optional().nullable(),
    nomeCliente: z
      .string({
        invalid_type_error: "O campo nomeCliente deve ser uma string",
      })
      .optional()
      .nullable(),
    telefoneCliente: z
      .string({
        invalid_type_error: "O campo telefone deve ser uma string",
      })
      .optional()
      .nullable(),
    enderecoCliente: z
      .string({
        invalid_type_error: "O campo endereco deve ser uma string",
      })
      .optional()
      .nullable(),
  },
  {
    description: "Schema para criar uma reserva",
    required_error: "Informe o objeto de reserva",
    invalid_type_error: "O objeto de reserva deve ser um objeto",
  }
);
export const createReservaSchema = z.object(
  {
    clienteId: z
      .number({
        invalid_type_error: "O campo clienteId deve ser um numero",
      })
      .int()
      .nullable()
      .optional(),
    quadraId: z
      .number({
        required_error: "O campo quadraId é obrigatório",
        invalid_type_error: "O campo quadraId deve ser um numero",
      })
      .int(),
    inicio: z
      .string({
        required_error: "O campo inicio é obrigatório",
        invalid_type_error:
          "O campo inicio deve ser uma string no formato YYYY-MM-DDTHH:MM:SS",
      })
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
        "O campo inicio deve estar no formato YYYY-MM-DDTHH:MM:SS"
      ),

    fim: z
      .string({
        required_error: "O campo fim é obrigatório",
        invalid_type_error:
          "O campo fim deve ser uma string no formato YYYY-MM-DDTHH:MM:SS",
      })
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
        "O campo fim deve estar no formato YYYY-MM-DDTHH:MM:SS"
      ),
    observacoes: z.string().max(500).optional().nullable(),
    recorrente: z.boolean().default(false).optional(),
  },
  {
    description: "Schema para criar uma reserva",
    required_error: "Informe o objeto de reserva",
    invalid_type_error: "O objeto de reserva deve ser um objeto",
  }
);

export const listarReservasDisponiveisSchema = z.object(
  {
    quadraId: z
      .number({
        required_error: "O campo quadraId é obrigatório",
        invalid_type_error: "O campo quadraId deve ser um numero",
      })
      .int(),
    inicio: z
      .string({
        required_error: "O campo inicio é obrigatório",
        invalid_type_error:
          "O campo inicio deve ser uma string no formato YYYY-MM-DDTHH:MM:SS",
      })
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
        "O campo inicio deve estar no formato YYYY-MM-DDTHH:MM:SS"
      ),

    fim: z
      .string({
        required_error: "O campo fim é obrigatório",
        invalid_type_error:
          "O campo fim deve ser uma string no formato YYYY-MM-DDTHH:MM:SS",
      })
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
        "O campo fim deve estar no formato YYYY-MM-DDTHH:MM:SS"
      ),
  },
  {
    description: "Schema para listar horarios",
    required_error: "Informe o objeto",
    invalid_type_error: "O objeto de horas disponiveis deve ser um objeto",
  }
);
export const listarReservasDisponiveisPublicoSchema = z.object(
  {
    contaId: z
      .number({
        required_error: "O campo contaId é obrigatório",
        invalid_type_error: "O campo contaId deve ser um numero",
      })
      .int(),
    quadraId: z
      .number({
        required_error: "O campo quadraId é obrigatório",
        invalid_type_error: "O campo quadraId deve ser um numero",
      })
      .int(),
    inicio: z
      .string({
        required_error: "O campo inicio é obrigatório",
        invalid_type_error:
          "O campo inicio deve ser uma string no formato YYYY-MM-DDTHH:MM:SS",
      })
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
        "O campo inicio deve estar no formato YYYY-MM-DDTHH:MM:SS"
      ),

    fim: z
      .string({
        required_error: "O campo fim é obrigatório",
        invalid_type_error:
          "O campo fim deve ser uma string no formato YYYY-MM-DDTHH:MM:SS",
      })
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
        "O campo fim deve estar no formato YYYY-MM-DDTHH:MM:SS"
      ),
  },
  {
    description: "Schema para listar horarios",
    required_error: "Informe o objeto",
    invalid_type_error: "O objeto de horas disponiveis deve ser um objeto",
  }
);

export const BodyCobrancaPublicoSchema = z.object({
  contaId: z
    .number({
      required_error: "O campo contaId é obrigatório",
      invalid_type_error: "O campo contaId deve ser um numero",
    })
    .int(),
  type: z.enum(["PIX", "BOLETO", "LINK"], {
    required_error: "O campo type é obrigatório",
    invalid_type_error: "O campo type deve ser PIX, BOLETO ou LINK",
  }),
  value: z
    .number({
      required_error: "O campo value é obrigatório",
      invalid_type_error: "O campo value deve ser um numero",
    })
    .positive(),
  gateway: z.enum(["mercadopago", "pagseguro", "asaas"], {
    required_error: "O campo gateway é obrigatório",
    invalid_type_error:
      "O campo gateway deve ser mercadopago, pagseguro ou asaas",
  }),
  clienteId: z
    .number({
      invalid_type_error: "O campo clienteId deve ser um numero",
    })
    .int()
    .optional()
    .nullable(),
  vinculo: z
    .object({
      id: z.number({
        required_error: "O campo id é obrigatório",
        invalid_type_error: "O campo id deve ser um numero",
      }).int(),
      tipo: z.enum(["parcela", "venda", "os", "reserva"], {
        required_error: "O campo tipo é obrigatório",
        invalid_type_error:
          "O campo tipo deve ser parcela, venda, os ou reserva",
      }),
    }, {
      invalid_type_error: "O campo vinculo deve ser um objeto",
    })
    .optional(),
}, {
  required_error: "Informe o objeto",
  invalid_type_error: "O objeto de cobranca deve ser um objeto",
});

export type BodyCobrancaPublico = z.infer<typeof BodyCobrancaPublicoSchema>;
