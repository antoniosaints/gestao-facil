module.exports = {
  apps: [
    {
      name: "app-dev",
      script: "dist/server.js",
      instances: "max",
      exec_mode: "cluster",
    },
    {
      name: "worker-email",
      script: "dist/workers/sendEmailWorker.js",
      instances: "max",
      exec_mode: "cluster",
    },
    {
      name: "worker-notification",
      script: "dist/workers/pushNotificationWorker.js",
      instances: "max",
      exec_mode: "cluster",
    },
  ],
};
