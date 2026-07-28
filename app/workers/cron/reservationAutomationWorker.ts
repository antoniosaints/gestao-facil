import { Worker } from "bullmq";
import { redisConnecion } from "../../utils/redis";
import { processReservationAutomations } from "../../services/reservas/reservaService";

export function reservationAutomationWorker() {
  return new Worker(
    "reservation-automations",
    async () => processReservationAutomations(),
    { connection: redisConnecion, concurrency: 1 },
  );
}
