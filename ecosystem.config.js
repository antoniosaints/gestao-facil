module.exports = {
  apps: [
    {
      name: "app-dev",
      script: "dist/server.js"
    },
    {
      name: "worker-email",
      script: "dist/workers/sendEmailWorker.js",
    },
    {
      name: "worker-notification",
      script: "dist/workers/pushNotificationWorker.js",
    },
  ],
};
