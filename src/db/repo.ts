import type { Database } from "bun:sqlite";

export interface TeamRow {
  number: number;
  sheet_key: string | null;
  sheet_label: string | null;
  open: number;
  text_channel_id: string | null;
  voice_channel_id: string | null;
  desafio: string | null;
  desafio_at: string | null;
  created_at: string;
}

export interface TeamWithCount extends TeamRow {
  members: number;
}

export interface ParticipantRow {
  discord_id: string;
  email_hash: string;
  display_name: string;
  team_number: number | null;
  forced: number;
  checked_in_at: string;
}

export interface CategoryRow {
  idx: number;
  text_category_id: string | null;
  voice_category_id: string | null;
}

/** Acesso ao SQLite. Todas as funções são síncronas (bun:sqlite). */
export class Repo {
  constructor(readonly db: Database) {}

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ── Participantes ────────────────────────────────────────
  participant(discordId: string): ParticipantRow | null {
    return this.db.query<ParticipantRow, [string]>("SELECT * FROM participants WHERE discord_id = ?").get(discordId);
  }

  participantByEmailHash(hash: string): ParticipantRow | null {
    return this.db.query<ParticipantRow, [string]>("SELECT * FROM participants WHERE email_hash = ?").get(hash);
  }

  insertParticipant(p: { discordId: string; emailHash: string; displayName: string; teamNumber: number | null; forced?: boolean }) {
    this.db
      .query("INSERT INTO participants (discord_id, email_hash, display_name, team_number, forced) VALUES (?, ?, ?, ?, ?)")
      .run(p.discordId, p.emailHash, p.displayName, p.teamNumber, p.forced ? 1 : 0);
  }

  setParticipantTeam(discordId: string, teamNumber: number | null) {
    this.db.query("UPDATE participants SET team_number = ? WHERE discord_id = ?").run(teamNumber, discordId);
  }

  deleteParticipant(discordId: string) {
    this.db.query("DELETE FROM participants WHERE discord_id = ?").run(discordId);
  }

  teamMembers(teamNumber: number): ParticipantRow[] {
    return this.db
      .query<ParticipantRow, [number]>("SELECT * FROM participants WHERE team_number = ? ORDER BY checked_in_at")
      .all(teamNumber);
  }

  countParticipants(): number {
    return this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM participants").get()!.n;
  }

  // ── Equipes ──────────────────────────────────────────────
  createTeam(t: { sheetKey: string | null; sheetLabel: string | null; open: boolean }): TeamRow {
    return this.db
      .query<TeamRow, [string | null, string | null, number]>(
        "INSERT INTO teams (sheet_key, sheet_label, open) VALUES (?, ?, ?) RETURNING *",
      )
      .get(t.sheetKey, t.sheetLabel, t.open ? 1 : 0)!;
  }

  team(number: number): TeamRow | null {
    return this.db.query<TeamRow, [number]>("SELECT * FROM teams WHERE number = ?").get(number);
  }

  teamBySheetKey(key: string): TeamRow | null {
    return this.db.query<TeamRow, [string]>("SELECT * FROM teams WHERE sheet_key = ?").get(key);
  }

  teamByChannel(channelId: string): TeamRow | null {
    return this.db
      .query<TeamRow, [string, string]>("SELECT * FROM teams WHERE text_channel_id = ? OR voice_channel_id = ?")
      .get(channelId, channelId);
  }

  teamsWithCounts(): TeamWithCount[] {
    return this.db
      .query<TeamWithCount, []>(
        `SELECT t.*, (SELECT COUNT(*) FROM participants p WHERE p.team_number = t.number) AS members
         FROM teams t ORDER BY t.number`,
      )
      .all();
  }

  setTeamLabel(number: number, label: string) {
    this.db.query("UPDATE teams SET sheet_label = ? WHERE number = ?").run(label, number);
  }

  setTeamChannels(number: number, textId: string | null, voiceId: string | null) {
    this.db.query("UPDATE teams SET text_channel_id = ?, voice_channel_id = ? WHERE number = ?").run(textId, voiceId, number);
  }

  setDesafio(number: number, desafioId: string) {
    this.db
      .query("UPDATE teams SET desafio = ?, desafio_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE number = ?")
      .run(desafioId, number);
  }

  // ── Meta (chave/valor) ───────────────────────────────────
  getMeta(key: string): string | null {
    return this.db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(key)?.value ?? null;
  }

  setMeta(key: string, value: string) {
    this.db
      .query("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  // ── Categorias ───────────────────────────────────────────
  category(idx: number): CategoryRow | null {
    return this.db.query<CategoryRow, [number]>("SELECT * FROM team_categories WHERE idx = ?").get(idx);
  }

  saveCategory(c: CategoryRow) {
    this.db
      .query(
        `INSERT INTO team_categories (idx, text_category_id, voice_category_id) VALUES (?, ?, ?)
         ON CONFLICT(idx) DO UPDATE SET text_category_id = excluded.text_category_id, voice_category_id = excluded.voice_category_id`,
      )
      .run(c.idx, c.text_category_id, c.voice_category_id);
  }
}
