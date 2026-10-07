import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Cada item é uma migração; a posição no array é a versão (PRAGMA user_version). */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE teams (
    number INTEGER PRIMARY KEY AUTOINCREMENT,   -- equipe-NNN (nunca reutilizado)
    sheet_key TEXT UNIQUE,                      -- chave da coluna Equipe; NULL = formada pelo bot
    sheet_label TEXT,
    open INTEGER NOT NULL DEFAULT 1,            -- aceita individuais
    text_channel_id TEXT,
    voice_channel_id TEXT,
    desafio TEXT,
    desafio_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE participants (
    discord_id TEXT PRIMARY KEY,
    email_hash TEXT NOT NULL UNIQUE,            -- sha256 do e-mail normalizado (e-mail não é guardado)
    display_name TEXT NOT NULL,
    team_number INTEGER REFERENCES teams(number),
    forced INTEGER NOT NULL DEFAULT 0,
    checked_in_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX participants_team ON participants(team_number);
  CREATE TABLE team_categories (
    idx INTEGER PRIMARY KEY,                    -- 0 = equipes 1..25, 1 = 26..50, ...
    text_category_id TEXT,
    voice_category_id TEXT
  );
  `,
];

export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: Database) {
  const current = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    })();
  }
}
