import { z } from "zod";

export const createQuadraSchema = z.object(
  {
    tempoMinimo: z.number().int().default(60).optional(),
    tempoReserva: z.number().int().default(60).optional(),
    active: z.boolean().default(true).optional(),
    name: z.string({
      required_error: "O campo name é obrigatório",
      invalid_type_error: "O campo name deve ser uma string",
    }).min(1).max(100),
    precoHora: z.number({
      required_error: "O campo precoHora é obrigatório",
      invalid_type_error: "O campo precoHora deve ser um número",
    }).int().default(0).optional(),
    description: z.string().max(500).optional().nullable(),
    permitirReservaOnline: z.boolean().default(true).optional(),
    aprovarSemPagamento: z.boolean().default(false).optional(),
  },
  {
    description: "Schema para criar uma reserva",
    required_error: "Informe o objeto de reserva",
    invalid_type_error: "O objeto de reserva deve ser um objeto",
  }
);