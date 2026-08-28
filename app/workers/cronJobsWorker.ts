import { recurrencyFinanceWorker } from "./cron/recurrencyFinanceWorker";
import { financialDueNotificationWorker } from "./cron/financialDueNotificationWorker";
import { Queue } from "bullmq";
import { redisConnecion } from "../utils/redis";
import { storeReservationExpirationWorker } from "./cron/storeReservationExpirationWorker";
import { reservationAutomationWorker } from "./cron/reservationAutomationWorker";
import { restaurantPixExpirationWorker } from "./cron/restaurantPixExpirationWorker";

const workerFinanceiro = recurrencyFinanceWorker();
const workerVencimentosFinanceiros = financialDueNotificationWorker();
const workerReservasLoja = storeReservationExpirationWorker();
const reservasLojaQueue = new Queue("store-reservation-expiration", { connection: redisConnecion });
const workerReservas = reservationAutomationWorker();
const workerPixRestaurante = restaurantPixExpirationWorker();
const reservasQueue = new Queue("reservation-automations", { connection: redisConnecion });
const pixRestauranteQueue = new Queue("restaurant-pix-expiration", { connection: redisConnecion });
void reservasLojaQueue.upsertJobScheduler("expire-store-reservations", { every: 60_000 }, { name: "expire" });
void reservasQueue.upsertJobScheduler("process-reservation-automations", { every: 60_000 }, { name: "process" });
void pixRestauranteQueue.upsertJobScheduler("expire-restaurant-pix", { every: 60_000 }, { name: "expire" });

process.on("SIGINT", async () => {
  console.log("Encerrando o worker...");
  await workerFinanceiro.close();
  await workerVencimentosFinanceiros.close();
  await workerReservasLoja.close();
  await workerReservas.close();
  await workerPixRestaurante.close();
  await reservasLojaQueue.close();
  await reservasQueue.close();
  await pixRestauranteQueue.close();
  process.exit(0);
});
