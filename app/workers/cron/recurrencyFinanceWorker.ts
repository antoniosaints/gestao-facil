import { Job, Queue, Worker } from 'bullmq'

import { redisConnecion } from '../../utils/redis'
import { processDueSubscriptionCycles } from '../../services/assinaturas/recorrenciaService'
import { processarRecorrenciasAutomaticas } from '../../services/financeiro/lancamentoRecorrenciaService'

const financeQueue = 'recurrencyFinance'
const queue = new Queue(financeQueue, {
  connection: redisConnecion,
})

const RECURRENCY_FINANCE_PATTERN = '*/10 * * * *'

;(async () => {
  const schedulers = await queue.getJobSchedulers()
  await Promise.all(
    schedulers
      .filter((job) => job.name === financeQueue && job.pattern !== RECURRENCY_FINANCE_PATTERN)
      .map((job) => queue.removeJobScheduler(job.key)),
  )

  await queue.upsertJobScheduler(
    financeQueue,
    { pattern: RECURRENCY_FINANCE_PATTERN },
    {
      name: financeQueue,
      opts: {
        removeOnComplete: 20,
        removeOnFail: 20,
      },
    },
  )
})().catch((error) => {
  console.error('[recurrencyFinance] erro ao agendar worker:', error)
})

async function cleanupCurrentJobIfStale(job: Job) {
  const schedulerId = typeof job.id === 'string' ? job.id.split(':')[1] : null
  if (!schedulerId) return

  const scheduler = await queue.getJobScheduler(schedulerId)
  if (!scheduler || scheduler.pattern === RECURRENCY_FINANCE_PATTERN) return

  await queue.removeJobScheduler(scheduler.key)
  if (scheduler) {
    console.warn(
      `[recurrencyFinance] agendamento legado removido: pattern=${scheduler.pattern || scheduler.every}`,
    )
  }
}

export const recurrencyFinanceWorker = () => {
  const worker = new Worker(
    financeQueue,
    async (job: Job) => {
      await cleanupCurrentJobIfStale(job)

      const summary = await processDueSubscriptionCycles()
      console.log(
        `[recurrencyFinance] job=${job.id} checked=${summary.checked} created=${summary.created} failed=${summary.failed}`,
      )

      if (summary.errors.length) {
        console.error('[recurrencyFinance] errors:', summary.errors)
      }

      // Lançamentos recorrentes com geração automática ligada: gera a próxima
      // ocorrência quando a parcela vigente entra na janela de antecedência.
      const recorrencias = await processarRecorrenciasAutomaticas()
      if (recorrencias.checked) {
        console.log(
          `[lancamentosRecorrentes] job=${job.id} checked=${recorrencias.checked} created=${recorrencias.created} finished=${recorrencias.finished} failed=${recorrencias.failed}`,
        )
      }

      if (recorrencias.errors.length) {
        console.error('[lancamentosRecorrentes] errors:', recorrencias.errors)
      }

      return { summary, recorrencias }
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
