import type { Database } from "bun:sqlite";

export type RequestStatus = "aberta" | "em_atendimento" | "finalizada" | "cancelada";

export interface MentoringRequest {
  id: number;
  team_number: number;
  topic: string;
  description: string;
  requested_by: string;
  requested_mentor_id: string | null;
  status: RequestStatus;
  mentor_id: string | null;
  granted_access: number;
  queue_message_id: string | null;
  alerted: number;
  created_at: string;
  claimed_at: string | null;
  finished_at: string | null;
}

export type CreateResult = { ok: true; request: MentoringRequest } | { ok: false; active: MentoringRequest };
export type ClaimResult =
  | { ok: true; request: MentoringRequest }
  | { ok: false; reason: "not_found" | "already_claimed" | "closed"; request: MentoringRequest | null };
export type FinishResult =
  | { ok: true; request: MentoringRequest; minutes: number }
  | { ok: false; reason: "not_found" | "not_in_progress" | "not_owner"; request: MentoringRequest | null };

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** Fila de mentoria no SQLite. Transições de estado são atômicas (UPDATE ... WHERE status = ...). */
export class MentoringRequests {
  constructor(private readonly db: Database) {}

  get(id: number): MentoringRequest | null {
    return this.db.query<MentoringRequest, [number]>("SELECT * FROM mentoring_requests WHERE id = ?").get(id);
  }

  activeForTeam(teamNumber: number): MentoringRequest | null {
    return this.db
      .query<MentoringRequest, [number]>(
        "SELECT * FROM mentoring_requests WHERE team_number = ? AND status IN ('aberta','em_atendimento')",
      )
      .get(teamNumber);
  }

  create(r: {
    teamNumber: number;
    topic: string;
    description: string;
    requestedBy: string;
    requestedMentorId: string | null;
  }): CreateResult {
    return this.db.transaction((): CreateResult => {
      const active = this.activeForTeam(r.teamNumber);
      if (active) return { ok: false, active };
      const request = this.db
        .query<MentoringRequest, [number, string, string, string, string | null]>(
          `INSERT INTO mentoring_requests (team_number, topic, description, requested_by, requested_mentor_id)
           VALUES (?, ?, ?, ?, ?) RETURNING *`,
        )
        .get(r.teamNumber, r.topic, r.description, r.requestedBy, r.requestedMentorId)!;
      return { ok: true, request };
    })();
  }

  setQueueMessage(id: number, messageId: string) {
    this.db.query("UPDATE mentoring_requests SET queue_message_id = ? WHERE id = ?").run(messageId, id);
  }

  setGrantedAccess(id: number) {
    this.db.query("UPDATE mentoring_requests SET granted_access = 1 WHERE id = ?").run(id);
  }

  /** Um mentor por solicitação: só a primeira chamada vence. */
  claim(id: number, mentorId: string): ClaimResult {
    const changed = this.db
      .query(`UPDATE mentoring_requests SET status = 'em_atendimento', mentor_id = ?, claimed_at = ${NOW} WHERE id = ? AND status = 'aberta'`)
      .run(mentorId, id).changes;
    const request = this.get(id);
    if (changed === 1) return { ok: true, request: request! };
    if (!request) return { ok: false, reason: "not_found", request };
    return { ok: false, reason: request.status === "em_atendimento" ? "already_claimed" : "closed", request };
  }

  /** Finaliza; só o mentor que atendeu (ou a organização, com force) pode. */
  finish(id: number, byUserId: string, force = false): FinishResult {
    const request = this.get(id);
    if (!request) return { ok: false, reason: "not_found", request };
    if (request.status !== "em_atendimento") return { ok: false, reason: "not_in_progress", request };
    if (!force && request.mentor_id !== byUserId) return { ok: false, reason: "not_owner", request };
    const changed = this.db
      .query(`UPDATE mentoring_requests SET status = 'finalizada', finished_at = ${NOW} WHERE id = ? AND status = 'em_atendimento'`)
      .run(id).changes;
    if (changed !== 1) return { ok: false, reason: "not_in_progress", request: this.get(id) };
    const done = this.get(id)!;
    const minutes = Math.max(0, Math.round((Date.parse(done.finished_at!) - Date.parse(done.claimed_at!)) / 60_000));
    return { ok: true, request: done, minutes };
  }

  /** Cancela uma solicitação ainda não atendida. */
  cancel(id: number): boolean {
    return this.db.query("UPDATE mentoring_requests SET status = 'cancelada', finished_at = " + NOW + " WHERE id = ? AND status = 'aberta'").run(id).changes === 1;
  }

  /** Abertas há mais de `minutes` minutos e ainda sem aviso. */
  overdue(minutes: number, now = new Date()): MentoringRequest[] {
    const cutoff = new Date(now.getTime() - minutes * 60_000).toISOString();
    return this.db
      .query<MentoringRequest, [string]>(
        "SELECT * FROM mentoring_requests WHERE status = 'aberta' AND alerted = 0 AND created_at < ? ORDER BY id",
      )
      .all(cutoff);
  }

  markAlerted(id: number) {
    this.db.query("UPDATE mentoring_requests SET alerted = 1 WHERE id = ?").run(id);
  }

  listActive(): MentoringRequest[] {
    return this.db
      .query<MentoringRequest, []>("SELECT * FROM mentoring_requests WHERE status IN ('aberta','em_atendimento') ORDER BY id")
      .all();
  }
}
