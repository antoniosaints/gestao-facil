import { z } from "zod";

export const createReservaSchema = z.object(
  {
    clienteId: z
      .number({
        invalid_type_error: "O campo clienteId deve ser um numero",
      })
      .int()
      .optional()
      .nullable(),
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
    observacoes: z.string().max(500).optional(),
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
