// import { recurrencyFinanceWorker } from "./cron/recurrencyFinanceWorker";
import { financialDueNotificationWorker } from "./cron/financialDueNotificationWorker";

// const workerFinanceiro = recurrencyFinanceWorker();
const workerVencimentosFinanceiros = financialDueNotificationWorker();

process.on("SIGINT", async () => {
  console.log("Encerrando o worker...");
  // await workerFinanceiro.close();
  await workerVencimentosFinanceiros.close();
  process.exit(0);
});
