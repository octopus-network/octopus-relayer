import { dbRunAsync, dbAllAsync, upsertSessions } from './db'
import { Session } from './interfaces'

export async function getLastNotCompletedSession(): Promise<Session> {
  const sections: Session[] = await dbAllAsync(
    'SELECT * FROM sessions WHERE status=0 ORDER BY height DESC LIMIT 1'
  )
  return sections[0]
}

export async function storeSession(height: number): Promise<any> {
  await upsertSessions({
    height,
    status: 0,
  })
}

export async function sessionCompleted(height: number) {
  await dbRunAsync(`UPDATE sessions SET status = ? WHERE height == ?`, [
    1,
    height,
  ])
}

export async function markFailedSession(height: number) {
  await upsertSessions({
    height,
    status: 2,
    failed_at: Date.now(),
  })
}
