import {
  processAppchainMessages,
  checkAnchorMessagesNeedProcess,
} from './nearCalls'
import { dbRunAsync, dbGetAsync, upsertMessageProcessingProblems } from './db'
import { Action } from './interfaces'
import { MINUTE, updateStateMinInterval } from './constants'

export async function confirmProcessingMessages(): Promise<
  boolean | undefined
> {
  try {
    const healthy = await isProcessingHealthy()
    const needProcess = await checkAnchorMessagesNeedProcess()

    if (healthy && needProcess) {
      const { result, returnVal } = await processAppchainMessages()
      await unmarkLastProblem()
      if (returnVal === 'NeedMoreGas') {
        return await confirmProcessingMessages()
      } else if (returnVal.Error) {
        console.error('confirmProcessingMessages error', returnVal.Error)
        if (result.transaction_outcome) {
          await updateLastProblem(result.transaction_outcome.id)
          console.error(
            'confirmProcessingMessages error-txId',
            result.transaction_outcome.id
          )
        }
      } else {
        return true
      }
    }
  } catch (e: any) {
    console.error('confirmProcessingMessages failed', e)
    if (e.transaction_outcome) {
      await updateLastProblem(e.transaction_outcome.id)
      console.error(
        'confirmProcessingMessages failed-txId',
        e.transaction_outcome.id
      )
    }
  }
}

async function updateLastProblem(txId: string) {
  await upsertMessageProcessingProblems({
    type: 1,
    tx_id: txId,
    failed_at: Date.now(),
    status: 0,
  })
  const problem = await getLastProcessingProblem()
  console.log('updateLastProblem', problem)
}

async function unmarkLastProblem() {
  await dbRunAsync(
    `UPDATE last_message_processing_problems SET status = ? WHERE type == 1`,
    [1]
  )
  const problem = await getLastProcessingProblem()
  console.log('unmarkLastProblem', problem)
}

async function getLastProcessingProblem(): Promise<Action> {
  const lastMessageProcessingProblem: Action = await dbGetAsync(
    `SELECT * FROM last_message_processing_problems WHERE type == 1`
  )
  return lastMessageProcessingProblem
}

export async function isProcessingHealthy() {
  const problem = await getLastProcessingProblem()
  if (
    !problem ||
    problem.status == 1 ||
    Date.now() - problem.failed_at > updateStateMinInterval * MINUTE
  ) {
    return true
  } else {
    return false
  }
}
