const { promisify } = require("util");
const sqlite3 = require("sqlite3").verbose();
const { exec } = require('child_process');
const upsert = require("sqlite3-upsert");
const db = new sqlite3.Database("relayer.db");
export const dbRunAsync = promisify(db.run.bind(db));
export const dbAllAsync = promisify(db.all.bind(db));
export const dbGetAsync = promisify(db.get.bind(db));
const execAsync = promisify(exec);

export async function initDb() {
  // status
  // 0: received, 1: relayed, 2: failed
  await dbRunAsync(
    "CREATE TABLE IF NOT EXISTS commitments(height INTEGER, commitment TEXT, created_at TEXT, updated_at TEXT, tx_id TEXT, status INTEGER)"
  );
  // status
  // 0: inProgress, 1: successful, 2: failed
  await dbRunAsync(
    "CREATE TABLE IF NOT EXISTS actions(type TEXT, status INTEGER)"
  );
  // type == 1 means for commitments
  await dbRunAsync(
    "CREATE TABLE IF NOT EXISTS last_synced_blocks(height INTEGER, type INTEGER)"
  );

  // status
  // 0: exists
  // 1: handled
  await dbRunAsync(
    "CREATE TABLE IF NOT EXISTS last_message_processing_problems(type INTEGER, tx_id TEXT, failed_at INTEGER, status INTEGER)"
  );
  await migrate();
}

export async function migrate() {
  const migrationsTable = await dbGetAsync("SELECT name FROM sqlite_master WHERE name ='migrations' and type='table'");
  if (!migrationsTable) {
    try {
      await execAsync("npm run migrate-up");
      console.log("migrate-up finished");
    } catch (e) {
      throw e;
    }
  }
}

export const upsertLastSyncedBlocks = promisify(
  upsert({
    table: "last_synced_blocks",
    key: "type",
    db: db,
  })
);

export const upsertMessageProcessingProblems = promisify(
  upsert({
    table: "last_message_processing_problems",
    key: "type",
    db: db,
  })
);

export const upsertActions = promisify(
  upsert({
    table: "actions",
    key: "type",
    db: db,
  })
);
