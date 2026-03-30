import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'app/server.ts',
    'app/workers/sendEmailWorker.ts',
    'app/workers/pushNotificationWorker.ts',
    'app/workers/cronJobsWorker.ts',
  ],
  format: ['cjs'],
  clean: true,
  sourcemap: true,
  outDir: 'dist',
  target: 'node20',
  platform: 'node',
})
