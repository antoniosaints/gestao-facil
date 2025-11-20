import { recurrencyFinanceWorker } from "./cron/recurrencyFinanceWorker";

const workerFinanceiro = recurrencyFinanceWorker();

process.on("SIGINT", async () => {
  console.log("Encerrando o worker...");
  await workerFinanceiro.close();
  process.exit(0);
});
