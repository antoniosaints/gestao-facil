module.exports = {
  apps: [
    {
      name: "app-dev",
      script: "dist/server.js",
      instances: 4,
      exec_mode: "cluster",
    },
    {
      name: "worker-email",
      script: "dist/workers/sendEmailWorker.js",
      instances: 1,
      exec_mode: "fork",
    },
    {
      name: "worker-fiscal",
      script: "dist/workers/fiscalEmissionWorker.js",
      instances: 1,
      exec_mode: "fork",
    },
    {
      name: "worker-notification",
      script: "dist/workers/pushNotificationWorker.js",
      instances: 1,
      exec_mode: "fork",
    },
    {
      name: "worker-whatsapp-notification",
      script: "dist/workers/whatsappNotificationWorker.js",
      instances: 1,
      exec_mode: "fork",
    },
    {
      name: "worker-whatsapp-webhook",
      script: "dist/workers/whatsappWebhookWorker.js",
      instances: 1,
      exec_mode: "fork",
    },
    {
      name: "worker-cron",
      script: "dist/workers/cronJobsWorker.js",
      instances: 2,
      exec_mode: "cluster",
    },
  ],
};
