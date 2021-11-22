const { promisify } = require("util");
const sqlite3 = require("sqlite3").verbose();
const upsert = require("sqlite3-upsert");
const db = new sqlite3.Database("relayer.db");
export const dbRunAsync = promisify(db.run.bind(db));
export const dbAllAsync = promisify(db.all.bind(db));
export const dbGetAsync = promisify(db.get.bind(db));

export function initDb() {
  // status
  // 0: received, 1: relayed, 2: failed
  db.run(
    "CREATE TABLE IF NOT EXISTS commitments(height INTEGER, commitment TEXT, created_at TEXT, updated_at TEXT, tx_id TEXT, status INTEGER)"
  );
  // status
  // 0: inProgress, 1: successful
  db.run("CREATE TABLE IF NOT EXISTS actions(type TEXT, status INTEGER)");
  // type == 1 means for commitments
  db.run(
    "CREATE TABLE IF NOT EXISTS last_synced_blocks(height INTEGER, type INTEGER)"
  );
}

export const upsertLastSyncedBlocks = promisify(
  upsert({
    table: "last_synced_blocks",
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
