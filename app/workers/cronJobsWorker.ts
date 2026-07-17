import { recurrencyFinanceWorker } from "./cron/recurrencyFinanceWorker";
import { financialDueNotificationWorker } from "./cron/financialDueNotificationWorker";
import { Queue } from "bullmq";
import { redisConnecion } from "../utils/redis";
import { storeReservationExpirationWorker } from "./cron/storeReservationExpirationWorker";

const workerFinanceiro = recurrencyFinanceWorker();
const workerVencimentosFinanceiros = financialDueNotificationWorker();
const workerReservasLoja = storeReservationExpirationWorker();
const reservasLojaQueue = new Queue("store-reservation-expiration", { connection: redisConnecion });
void reservasLojaQueue.upsertJobScheduler("expire-store-reservations", { every: 60_000 }, { name: "expire" });

process.on("SIGINT", async () => {
  console.log("Encerrando o worker...");
  await workerFinanceiro.close();
  await workerVencimentosFinanceiros.close();
  await workerReservasLoja.close();
  await reservasLojaQueue.close();
  process.exit(0);
});
