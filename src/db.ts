const { promisify } = require("util");
const sqlite3 = require("sqlite3").verbose();
const upsert = require("sqlite3-upsert");
const db = new sqlite3.Database("relayerDB");
export const dbRunAsync = promisify(db.run.bind(db));
export const dbAllAsync = promisify(db.all.bind(db));

export function initDb() {
  db.run(
    "CREATE TABLE IF NOT EXISTS proof_queue (height INTEGER, header TEXT, encoded_message TEXT)"
  );
}
