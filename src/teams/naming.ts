import { createHash } from "node:crypto";
import { normalizeEmail, shortName } from "./normalize";

export const pad3 = (n: number) => String(n).padStart(3, "0");

/** 7 → "equipe-007" */
export const teamName = (n: number) => `equipe-${pad3(n)}`;

/** Aceita "equipe-007", "007", "7", "Equipe 7" → 7. */
export function parseTeamRef(raw: string): number | null {
  const m = raw.trim().toLowerCase().match(/^(?:equipe[-\s]?)?0*(\d{1,4})$/);
  return m ? Number(m[1]) : null;
}

/** Índice da categoria (0 = equipes 1..perCategory). */
export const categoryIndex = (teamNumber: number, perCategory: number) => Math.floor((teamNumber - 1) / perCategory);

/** idx 0, 25/categoria → "EQUIPES-001-A-025" */
export function categoryName(idx: number, perCategory: number, voice = false): string {
  const start = idx * perCategory + 1;
  const end = start + perCategory - 1;
  return `EQUIPES-${pad3(start)}-A-${pad3(end)}${voice ? "-VOZ" : ""}`;
}

const NICK_MAX = 32;

/** "Maria Clara da Silva" + 7 → "Maria Silva | 007" (limite de 32 caracteres do Discord). */
export function buildNickname(fullName: string, teamNumber: number | null): string {
  const name = shortName(fullName) || "Participante";
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
