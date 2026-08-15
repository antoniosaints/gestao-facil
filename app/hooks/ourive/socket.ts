import { getIO } from "../../utils/socket";

export type OuriveOrderUpdatedEvent = {
  ordemId: number;
  status: "APROVADO" | "RECUSADO";
  versao: number;
  origem: string;
};

/** Notifica as telas autenticadas da conta para atualizarem a OS aberta. */
export function sendOuriveOrderUpdated(
  contaId: number,
  body: OuriveOrderUpdatedEvent,
) {
  getIO().to(`conta:${contaId}`).emit("ourive:ordem-atualizada", body);
}
