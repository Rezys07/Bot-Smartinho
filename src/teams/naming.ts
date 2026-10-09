import { createHash } from "node:crypto";
import { normalizeEmail, shortName } from "./normalize";

export const pad3 = (n: number) => String(n).padStart(3, "0");

/** Aceita "equipe-007", "team-007", "007", "7", "Equipe 7" → 7. */
export function parseTeamRef(raw: string): number | null {
  const m = raw.trim().toLowerCase().match(/^(?:(?:equipe|team)[-\s]?)?0*(\d{1,4})$/);
  return m ? Number(m[1]) : null;
}

/** Índice da categoria (0 = equipes 1..perCategory). */
export const categoryIndex = (teamNumber: number, perCategory: number) => Math.floor((teamNumber - 1) / perCategory);

/** Primeira e última equipe da categoria idx (0 → 1..25). */
export function categoryRange(idx: number, perCategory: number): { start: number; end: number } {
  const start = idx * perCategory + 1;
  return { start, end: start + perCategory - 1 };
}

const NICK_MAX = 32;

/** "Maria Clara da Silva" + 7 → "Maria Silva | 007" (limite de 32 caracteres do Discord). */
export function buildNickname(fullName: string, teamNumber: number | null, fallback = "Participante"): string {
  const name = shortName(fullName) || fallback;
  if (teamNumber === null) return name.slice(0, NICK_MAX);
  const suffix = ` | ${pad3(teamNumber)}`;
  if (name.length + suffix.length <= NICK_MAX) return name + suffix;
  // Não cabe: tenta só o primeiro nome, depois corta.
  const first = name.split(" ")[0]!;
  if (first.length + suffix.length <= NICK_MAX) return first + suffix;
  return first.slice(0, NICK_MAX - suffix.length) + suffix;
}

/** O banco guarda só o hash do e-mail (LGPD). */
export function emailHash(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

/**
 * Identidade da inscrição no banco: hash do e-mail; se a linha só tem usuário do Discord, hash do usuário.
 * É sempre calculada a partir da linha da planilha, então check-in por e-mail ou por usuário dá o mesmo valor.
 */
export function identityHash(insc: { email: string | null; usuario: string | null }): string {
  if (insc.email) return emailHash(insc.email);
  return createHash("sha256").update(`usuario:${insc.usuario ?? ""}`).digest("hex");
}
