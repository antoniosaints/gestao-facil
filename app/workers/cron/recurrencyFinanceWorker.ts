import { Job, Queue, Worker } from 'bullmq'

import { redisConnecion } from '../../utils/redis'
import { processDueSubscriptionCycles } from '../../services/assinaturas/recorrenciaService'

const financeQueue = 'recurrencyFinance'
const queue = new Queue(financeQueue, {
  connection: redisConnecion,
})

;(async () => {
  const existing = await queue.getJobSchedulers()
  const exists = existing.some((job) => job.name === financeQueue)

  if (!exists) {
    await queue.add(
      financeQueue,
      {},
      {
        repeat: {
          pattern: '*/5 * * * *',
        },
        removeOnComplete: 20,
        removeOnFail: 20,
      },
    )
  }
})()

export const recurrencyFinanceWorker = () => {
  const worker = new Worker(
    financeQueue,
    async (job: Job) => {
      const summary = await processDueSubscriptionCycles()
      console.log(
        `[recurrencyFinance] job=${job.id} checked=${summary.checked} created=${summary.created} failed=${summary.failed}`,
      )

      if (summary.errors.length) {
        console.error('[recurrencyFinance] errors:', summary.errors)
      }

      return summary
    },
    {
      connection: redisConnecion,
      concurrency: 1,
    },
  )

  worker.on('ready', () => {
    console.log('Worker de recorrência financeira iniciado com sucesso!')
  })

  worker.on('failed', (job, err) => {
    console.error('Erro no job:', job?.id, err)
  })

  return worker
}
