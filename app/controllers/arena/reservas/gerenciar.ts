import { Request, Response } from "express";
import { handleError } from "../../../utils/handleError";
import { prisma } from "../../../utils/prisma";
import { getCustomRequest } from "../../../helpers/getCustomRequest";
import { addMinutes, differenceInMinutes, isAfter, isBefore } from "date-fns";
import {
  createReservaPublicoSchema,
  createReservaSchema,
  listarReservasDisponiveisPublicoSchema,
  listarReservasDisponiveisSchema,
} from "../../../schemas/arena/reservas";
import { ResponseHandler } from "../../../utils/response";
import { enqueuePushNotification } from "../../../services/pushNotificationQueueService";
import { cancelarCobrancaMP } from "../../../services/financeiro/mercadoPagoManager";

export const createReservaPublico = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const {
      data: dto,
      error,
      success,
    } = createReservaPublicoSchema.safeParse(req.body);

    if (!success) {
      return handleError(res, error);
    }

    const start = new Date(dto.inicio);
    const end = new Date(dto.fim);

    const diferencaMinutos = differenceInMinutes(end, start);

    // transação para evitar race conditions
    const tsx = await prisma.$transaction(async (prismaTx) => {
      let cliente = null;
      // buscar conflitos: qualquer booking confirmado ou pendente que intersecte
      if (dto.clienteId) {
        cliente = await prismaTx.clientesFornecedores.findUnique({
          where: { id: dto.clienteId, contaId: dto.contaId },
        });
        if (!cliente) {
          throw new Error("Cliente nao encontrado.");
        }
      }

      const quadra = await prismaTx.arenaQuadras.findUnique({
        where: { id: dto.quadraId, contaId: dto.contaId },
      });

      if (!quadra) {
        throw new Error("Quadra não encontrada.");
      }

      const minutosMinimosQuadra = quadra.tempoMinimo;

      if (diferencaMinutos < minutosMinimosQuadra) {
        throw new Error(
          `A reserva deve ter pelo menos ${minutosMinimosQuadra} minutos.`
        );
      }

      const quantidadeReservada = diferencaMinutos / quadra.tempoReserva;
      const ValorTotalReserva = quadra.precoHora.times(quantidadeReservada);

      let booking: any = null;

      const conflict = await prismaTx.arenaAgendamentos.findFirst({
        where: {
          quadraId: dto.quadraId,
          status: { in: ["PENDENTE", "CONFIRMADA", "BLOQUEADO"] },
          AND: [
            { startAt: { lt: end } }, // start < new.end
            { endAt: { gt: start } }, // end > new.start
          ],
        },
      });

      if (conflict) {
        const now = new Date();
        const daqui30 = addMinutes(now, 30);
        if (
          conflict.status === "PENDENTE" &&
          isAfter(conflict.startAt, now) &&
          isBefore(conflict.startAt, daqui30)
        ) {
          await prismaTx.arenaAgendamentos.update({
            where: { id: conflict.id },
            data: {
              status: "CANCELADA",
              observacoes:
                "Cancelada por não pagamento antes dos 30 minutos do inicio da reserva",
            },
          });
        } else {
          throw new Error(
            "Conflito de horário: já existe reserva nesse período."
          );
        }
      }

      booking = await prismaTx.arenaAgendamentos.create({
        data: {
          quadraId: dto.quadraId,
          clienteId: dto.clienteId,
          nomeCliente: dto.nomeCliente,
          telefoneCliente: dto.telefoneCliente,
          enderecoCliente: dto.enderecoCliente,
          startAt: start,
          endAt: end,
          valor: ValorTotalReserva,
          recorrente: false,
          status: "PENDENTE",
          observacoes: dto.observacoes
            ? `${dto.observacoes}`
            : "Reserva online",
        },
      });

      return {
        booking,
        quadra,
      };
    });

    await enqueuePushNotification(
      {
        title: `Nova reserva online (${tsx.quadra.name})`,
        body: `Reserva de ${start.toLocaleString()} a ${end.toLocaleString()}, verifique o sistema para mais detalhes.`,
      },
      dto.contaId,
      true
    );

    return ResponseHandler(res, "Reserva criada com sucesso", tsx);
  } catch (error) {
    handleError(res, error);
  }
};
export const createReserva = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const {
      data: dto,
      error,
      success,
    } = createReservaSchema.safeParse(req.body);

    if (!success) {
      return handleError(res, error);
    }

    const start = new Date(dto.inicio);
    const end = new Date(dto.fim);

    const diferencaMinutos = differenceInMinutes(end, start);

    // transação para evitar race conditions
    const tsx = await prisma.$transaction(async (prismaTx) => {
      // buscar conflitos: qualquer booking confirmado ou pendente que intersecte
      if (dto.clienteId) {
        const cliente = await prismaTx.clientesFornecedores.findUnique({
          where: { id: dto.clienteId, contaId: customData.contaId },
        });
        if (!cliente) {
          throw new Error("Cliente nao encontrado.");
        }
      }

      const quadra = await prismaTx.arenaQuadras.findUnique({
        where: { id: dto.quadraId, contaId: customData.contaId },
      });

      if (!quadra) {
        throw new Error("Quadra não encontrada.");
      }

      const minutosMinimosQuadra = quadra.tempoMinimo;

      if (diferencaMinutos < minutosMinimosQuadra) {
        throw new Error(
          `A reserva deve ter pelo menos ${minutosMinimosQuadra} minutos.`
        );
      }

      const quantidadeReservada = diferencaMinutos / quadra.tempoReserva;
      const ValorTotalReserva = quadra.precoHora.times(quantidadeReservada);

      let booking: any = null;

      if (!req.query.id) {
        const conflict = await prismaTx.arenaAgendamentos.findFirst({
          include: {
            cobrancasFinanceiras: true,
          },
          where: {
            quadraId: dto.quadraId,
            status: { in: ["PENDENTE", "CONFIRMADA", "BLOQUEADO"] },
            AND: [
              { startAt: { lt: end } }, // start < new.end
              { endAt: { gt: start } }, // end > new.start
            ],
          },
        });

        if (conflict) {
          const now = new Date();
          const daqui30 = addMinutes(now, 30);
          if (
            conflict.status === "PENDENTE" &&
            isAfter(conflict.startAt, now) &&
            isBefore(conflict.startAt, daqui30)
          ) {
            await prismaTx.arenaAgendamentos.update({
              where: { id: conflict.id },
              data: {
                status: "CANCELADA",
                observacoes:
                  "Cancelada por não pagamento antes dos 30 minutos do inicio da reserva",
              },
            });
            if (conflict.cobrancasFinanceiras.length > 0) {
              await cancelarCobrancaMP(
                customData.contaId,
                conflict.cobrancasFinanceiras[0].idCobranca
              );
              await prismaTx.cobrancasFinanceiras.deleteMany({
                where: {
                  reservaId: conflict.id,
                },
              });
            }
          } else {
            throw new Error(
              "Conflito de horário: já existe reserva nesse período."
            );
          }
        }

        booking = await prismaTx.arenaAgendamentos.create({
          data: {
            quadraId: dto.quadraId,
            clienteId: dto.clienteId,
            startAt: start,
            endAt: end,
            valor: ValorTotalReserva,
            recorrente: dto.recorrente ?? false,
            status: "PENDENTE",
            observacoes: dto.observacoes ?? null,
          },
        });
      } else {
        const conflict = await prismaTx.arenaAgendamentos.findFirst({
          include: {
            arenaAgendamentosPagamentos: true,
          },
          where: {
            quadraId: dto.quadraId,
            status: { in: ["PENDENTE", "CONFIRMADA", "BLOQUEADO"] },
            AND: [
              { startAt: { lt: end } }, // start < new.end
              { endAt: { gt: start } }, // end > new.start
              { id: { not: Number(req.query.id) } },
            ],
          },
        });

        if (conflict) {
          const now = new Date();
          const daqui30 = addMinutes(now, 30);
          if (
            conflict.status === "PENDENTE" &&
            isAfter(conflict.startAt, now) &&
            isBefore(conflict.startAt, daqui30) &&
            conflict.arenaAgendamentosPagamentos.length === 0
          ) {
            await prismaTx.arenaAgendamentos.update({
              where: { id: conflict.id },
              data: {
                status: "CANCELADA",
                observacoes:
                  "Cancelada por não pagamento antes dos 30 minutos do inicio da reserva",
              },
            });
          } else {
            throw new Error(
              "Conflito de horário: já existe reserva nesse período."
            );
          }
        }

        booking = await prismaTx.arenaAgendamentos.update({
          where: { id: Number(req.query.id) },
          data: {
            quadraId: dto.quadraId,
            clienteId: dto.clienteId,
            startAt: start,
            endAt: end,
            valor: ValorTotalReserva,
            recorrente: dto.recorrente ?? false,
            status: "PENDENTE",
            observacoes: dto.observacoes ?? null,
          },
        });
      }

      return {
        booking,
        quadra,
      };
    });

    await enqueuePushNotification(
      {
        title: `Nova reserva (${tsx.quadra.name})`,
        body: `Reserva de ${start.toLocaleString()} a ${end.toLocaleString()}, verifique o sistema para mais detalhes.`,
      },
      customData.contaId,
      true
    );

    return ResponseHandler(res, "Reserva criada com sucesso", tsx);
  } catch (error) {
    handleError(res, error);
  }
};
export const deleteReserva = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const { id } = req.query;
    const reserva = await prisma.arenaAgendamentos.delete({
      where: {
        id: Number(id),
        status: { notIn: ["FINALIZADA"] },
        Quadra: {
          contaId: customData.contaId,
        },
      },
    });
    return ResponseHandler(res, "Reserva deletada", reserva);
  } catch (error) {
    handleError(res, error);
  }
};
export const confirmarReserva = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { id } = req.query;
    if (!id) {
      return ResponseHandler(res, "id nao informado!", null, 400);
    }
    const customData = getCustomRequest(req).customData;
    const reserva = await prisma.arenaAgendamentos.findUnique({
      where: { id: Number(id), Quadra: { contaId: customData.contaId } },
    });

    if (!reserva) {
      return ResponseHandler(res, "Reserva nao encontrada!", null, 400);
    }

    if (
      ["CANCELADA", "FINALIZADA", "BLOQUEADA", "CONFIRMADA"].includes(
        reserva.status
      )
    ) {
      return ResponseHandler(
        res,
        "Reserva nao pode ser confirmada!",
        null,
        400
      );
    }

    const re = await prisma.arenaAgendamentos.update({
      where: { id: Number(id) },
      data: { status: "CONFIRMADA" },
    });
    return ResponseHandler(res, "Reserva confirmada", re);
  } catch (error) {
    handleError(res, error);
  }
};
export const finalizarReserva = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { id } = req.query;
    if (!id) {
      return ResponseHandler(res, "id nao informado!", null, 400);
    }
    const customData = getCustomRequest(req).customData;
    const reserva = await prisma.arenaAgendamentos.findUnique({
      where: { id: Number(id), Quadra: { contaId: customData.contaId } },
    });

    if (!reserva) {
      return ResponseHandler(res, "Reserva nao encontrada!", null, 400);
    }

    if (
      ["CANCELADA", "FINALIZADA", "BLOQUEADA", "PENDENTE"].includes(
        reserva.status
      )
    ) {
      return ResponseHandler(
        res,
        "Reserva nao pode ser finalizada!",
        null,
        400
      );
    }

    const dataFinal = new Date(reserva.endAt);
    const dataAtual = new Date();

    if (isBefore(dataAtual, dataFinal)) {
      return ResponseHandler(
        res,
        "Reserva nao pode ser finalizada antes do horário informado!",
        null,
        400
      );
    }

    const re = await prisma.arenaAgendamentos.update({
      where: { id: Number(id) },
      data: { status: "FINALIZADA" },
    });
    return ResponseHandler(res, "Reserva finalizada", re);
  } catch (error) {
    handleError(res, error);
  }
};
export const cancelarReserva = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { id } = req.query;
    if (!id) {
      return ResponseHandler(res, "id nao informado!", null, 400);
    }
    const customData = getCustomRequest(req).customData;
    const reserva = await prisma.arenaAgendamentos.findUnique({
      include: { cobrancasOnAgendamentos: true },
      where: { id: Number(id), Quadra: { contaId: customData.contaId } },
    });

    if (!reserva) {
      return ResponseHandler(res, "Reserva nao encontrada!", null, 400);
    }

    if (["FINALIZADA", "CANCELADA", "BLOQUEADA"].includes(reserva.status)) {
      return ResponseHandler(res, "Reserva nao pode ser cancelada!", null, 400);
    }

    const re = await prisma.arenaAgendamentos.update({
      where: { id: Number(id) },
      data: { status: "CANCELADA" },
    });
    if (reserva.cobrancasOnAgendamentos && reserva.cobrancasOnAgendamentos.length > 0) {
      for (const cobranca of reserva.cobrancasOnAgendamentos) {
        const res = await prisma.cobrancasFinanceiras.findUniqueOrThrow({
          where: { id: cobranca.cobrancaId },
        })
        if (res.status === "PENDENTE") {
          await prisma.cobrancasFinanceiras.delete({
            where: { id: cobranca.cobrancaId },
          });
          await cancelarCobrancaMP(customData.contaId, res.idCobranca);
        }
      }
    }
    return ResponseHandler(res, "Reserva cancelada", re);
  } catch (error) {
    handleError(res, error);
  }
};
export const estornarReserva = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { id } = req.query;
    if (!id) {
      return ResponseHandler(res, "id nao informado!", null, 400);
    }
    const customData = getCustomRequest(req).customData;
    const reserva = await prisma.arenaAgendamentos.findUnique({
      where: { id: Number(id), Quadra: { contaId: customData.contaId } },
    });

    if (!reserva) {
      return ResponseHandler(res, "Reserva nao encontrada!", null, 400);
    }

    if (["BLOQUEADA", "CANCELADA", "PENDENTE"].includes(reserva.status)) {
      return ResponseHandler(res, "Reserva nao pode ser estornada!", null, 400);
    }

    const re = await prisma.arenaAgendamentos.update({
      where: { id: Number(id) },
      data: { status: "PENDENTE" },
    });
    return ResponseHandler(res, "Reserva estornada", re);
  } catch (error) {
    handleError(res, error);
  }
};
export const getReservas = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const { id, quadraId, inicio, fim } = req.query;
    const start = inicio ? new Date(inicio as string) : undefined;
    const end = fim ? new Date(fim as string) : undefined;

    if (req.query.id) {
      const reserva = await prisma.arenaAgendamentos.findUnique({
        where: {
          id: Number(req.query.id),
          Quadra: {
            contaId: customData.contaId,
          },
        },
      });
      return ResponseHandler(res, "Reserva encontrada", reserva);
    }

    const reservas = await prisma.arenaAgendamentos.findMany({
      include: {
        Quadra: true,
        Cliente: true,
      },
      where: {
        id: id ? Number(id) : undefined,
        quadraId: quadraId ? Number(quadraId) : undefined,
        Quadra: {
          contaId: customData.contaId,
        },
        startAt: {
          gte: start,
          lte: end,
        },
      },
    });
    return ResponseHandler(res, "Reservas encontradas", reservas);
  } catch (error) {
    return handleError(res, error);
  }
};
export const getSlotsDisponiveis = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const body = req.body;
    const { data, error, success } =
      listarReservasDisponiveisSchema.safeParse(body);

    if (!success) {
      return handleError(res, error);
    }

    const start = new Date(data.inicio);
    const end = new Date(data.fim);

    const quadra = await prisma.arenaQuadras.findUnique({
      where: {
        id: Number(body.quadraId),
        contaId: customData.contaId,
      },
    });

    if (!quadra) {
      return res.status(400).json({
        status: 400,
        message: "Quadra nao encontrada",
        data: null,
      });
    }

    const reservas = await prisma.arenaAgendamentos.findMany({
      where: {
        quadraId: Number(body.quadraId),
        status: { in: ["PENDENTE", "CONFIRMADA", "BLOQUEADO"] },
        AND: [
          { startAt: { lt: end } }, // começa antes do fim
          { endAt: { gt: start } }, // termina depois do início
        ],
      },
      orderBy: { startAt: "asc" },
    });

    let cursor = start;
    const slotsDisponiveis = [];

    for (
      ;
      cursor < end;
      cursor = new Date(cursor.getTime() + quadra.tempoReserva * 60000)
    ) {
      const slotStart = new Date(cursor);
      const slotEnd = new Date(cursor.getTime() + quadra.tempoReserva * 60000);

      if (slotEnd > end) break;

      const conflict = reservas.some(
        (b) => b.startAt < slotEnd && b.endAt > slotStart
      );

      if (!conflict) {
        slotsDisponiveis.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
        });
      }
    }

    return res.status(200).json({
      status: 200,
      message: "Slots disponiveis encontrados",
      data: slotsDisponiveis,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getSlotsDisponiveisPublico = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const body = req.body;
    const { data, error, success } =
      listarReservasDisponiveisPublicoSchema.safeParse(body);

    if (!success) {
      return handleError(res, error);
    }

    const start = new Date(data.inicio);
    const end = new Date(data.fim);
    const now = new Date();

    const quadra = await prisma.arenaQuadras.findUnique({
      where: {
        id: Number(data.quadraId),
        contaId: Number(data.contaId),
        active: true,
        permitirReservaOnline: true,
      },
    });

    if (!quadra) {
      return res.status(400).json({
        status: 400,
        message: "Quadra nao encontrada",
        data: null,
      });
    }

    const reservas = await prisma.arenaAgendamentos.findMany({
      where: {
        quadraId: Number(data.quadraId),
        status: { in: ["PENDENTE", "CONFIRMADA", "BLOQUEADO"] },
        AND: [{ startAt: { lt: end } }, { endAt: { gt: start } }],
      },
      orderBy: { startAt: "asc" },
    });

    let cursor = start;
    const slots = [];

    for (
      ;
      isBefore(cursor, end);
      cursor = new Date(cursor.getTime() + quadra.tempoReserva * 60000)
    ) {
      const slotStart = new Date(cursor);
      const slotEnd = new Date(cursor.getTime() + quadra.tempoReserva * 60000);

      if (slotEnd > end) break;

      // ignorar horários passados
      if (slotEnd <= now) continue;

      const conflict = reservas.some(
        (b) => b.startAt < slotEnd && b.endAt > slotStart
      );

      slots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        reservada: conflict,
      });
    }

    return res.status(200).json({
      status: 200,
      message: "Slots encontrados",
      data: slots,
    });
  } catch (error) {
    return handleError(res, error);
  }
};
