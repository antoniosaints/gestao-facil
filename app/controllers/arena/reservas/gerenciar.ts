import { Request, Response } from "express";
import { handleError } from "../../../utils/handleError";
import { prisma } from "../../../utils/prisma";
import { getCustomRequest } from "../../../helpers/getCustomRequest";
import { differenceInMinutes } from "date-fns";
import {
  createReservaSchema,
  listarReservasDisponiveisPublicoSchema,
  listarReservasDisponiveisSchema,
} from "../../../schemas/arena/reservas";
import { ResponseHandler } from "../../../utils/response";

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
    const reserva = await prisma.$transaction(async (prismaTx) => {
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
        throw new Error(
          "Conflito de horário: já existe reserva nesse período."
        );
      }

      const booking = await prismaTx.arenaAgendamentos.create({
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

      return booking;
    });

    return ResponseHandler(res, "Reserva criada com sucesso", reserva);
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
export const getSlotsDisponiveis = async (req: Request, res: Response): Promise<any> => {
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

export const getSlotsDisponiveisPublico = async (req: Request, res: Response): Promise<any> => {
  try {
    const body = req.body;
    const { data, error, success } =
      listarReservasDisponiveisPublicoSchema.safeParse(body);

    if (!success) {
      return handleError(res, error);
    }

    const start = new Date(data.inicio);
    const end = new Date(data.fim);

    const quadra = await prisma.arenaQuadras.findUnique({
      where: {
        id: Number(data.quadraId),
        contaId: Number(data.contaId),
        active: true,
        permitirReservaOnline: true
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

export const cancelarReserva = async (req: Request, res: Response) => {};
export const confirmarReserva = async (req: Request, res: Response) => {};
