import { isValidEmail, normalizeEmail, normalizeName } from "../teams/normalize";
import type { DeclaredTeam, Inscricao, ParsedSheet, SheetIssue } from "./types";

type Field = "email" | "nome" | "equipe";

/** Trechos (normalizados) que identificam cada coluna pelo título — a ordem das colunas não importa. */
const HEADER_MATCHERS: Record<Field, string[]> = {
  email: ["endereco de e mail", "e mail", "email"],
  nome: ["nome completo", "nome"],
  equipe: ["equipe", "time"],
};

const REQUIRED: Field[] = ["email", "nome"];

export function mapHeaders(header: string[]): { cols: Partial<Record<Field, number>>; missing: Field[] } {
  const norm = header.map((h) => normalizeName(h ?? ""));
  const cols: Partial<Record<Field, number>> = {};
  const used = new Set<number>();
  // "equipe" antes de "nome" para "Nome da equipe" não virar a coluna de nome.
  for (const field of ["email", "equipe", "nome"] as Field[]) {
    for (const needle of HEADER_MATCHERS[field]) {
      const idx = norm.findIndex((h, i) => !used.has(i) && (h === needle || h.includes(needle)));
      if (idx >= 0) {
        cols[field] = idx;
        used.add(idx);
        break;
      }
    }
  }
  const missing = (Object.keys(HEADER_MATCHERS) as Field[]).filter((f) => cols[f] === undefined);
  return { cols, missing };
}

const NO_TEAM = new Set(["", "sem equipe", "individual", "nenhuma", "nenhum", "nao", "x", "na", "n a"]);

/**
 * Normaliza o valor da coluna Equipe para comparar linhas:
 * "Equipe 07", "equipe-7", "7" → "7"; "Os Urbanistas" → "os urbanistas".
 */
export function teamKey(raw: string | null | undefined): string | null {
  const norm = normalizeName(raw ?? "");
  if (NO_TEAM.has(norm)) return null;
  const stripped = norm.replace(/^(equipe|time|grupo|team)\s+/, "").trim();
  if (/^\d+$/.test(stripped)) return String(Number(stripped));
  return stripped || null;
}

export function parseSheet(values: unknown[][], opts: { maxTeamSize: number }): ParsedSheet {
  const issues: SheetIssue[] = [];
  const byEmail = new Map<string, Inscricao>();
  const teams = new Map<string, DeclaredTeam>();
  if (values.length === 0) {
    issues.push({ kind: "missing_column", message: "Planilha vazia (sem cabeçalho)." });
    return { byEmail, all: [], teams, issues };
  }

  const { cols, missing } = mapHeaders((values[0] ?? []).map((v) => String(v ?? "")));
  for (const f of missing) {
    issues.push({
      kind: "missing_column",
      message: `Coluna não encontrada: ${f}${REQUIRED.includes(f) ? " (obrigatória)" : " (todos serão tratados como individuais)"}`,
    });
  }
  if (REQUIRED.some((f) => missing.includes(f))) return { byEmail, all: [], teams, issues };

  const cell = (r: unknown[], f: Field) => {
    const i = cols[f];
    return i === undefined ? "" : String(r[i] ?? "").trim();
  };

  for (let i = 1; i < values.length; i++) {
    const r = values[i] ?? [];
    const rowNumber = i + 1;
    if (r.every((c) => String(c ?? "").trim() === "")) continue;

    const email = normalizeEmail(cell(r, "email"));
    if (!isValidEmail(email)) {
      issues.push({ kind: "invalid_email", row: rowNumber, message: `Linha ${rowNumber}: e-mail ausente ou inválido.` });
      continue;
    }
    const nome = cell(r, "nome").replace(/\s+/g, " ");
    if (!nome) issues.push({ kind: "missing_name", row: rowNumber, message: `Linha ${rowNumber}: nome vazio.` });

    const equipeRaw = cell(r, "equipe");
    const insc: Inscricao = {
      row: rowNumber,
      email,
      nome,
      equipe: equipeRaw || null,
      equipeKey: teamKey(equipeRaw),
    };

    const previous = byEmail.get(email);
    if (previous) {
      issues.push({
        kind: "duplicate_email",
        row: rowNumber,
        message: `Linhas ${previous.row} e ${rowNumber}: mesmo e-mail repetido; vale a linha ${rowNumber}.`,
      });
    }
    byEmail.set(email, insc);
  }

  const all = [...byEmail.values()].sort((a, b) => a.row - b.row);
  for (const insc of all) {
    if (!insc.equipeKey) continue;
    const t = teams.get(insc.equipeKey) ?? { key: insc.equipeKey, label: insc.equipe!, members: [] };
    t.members.push(insc);
    teams.set(insc.equipeKey, t);
  }
  for (const t of teams.values()) {
    if (t.members.length > opts.maxTeamSize) {
      issues.push({
        kind: "oversize_team",
        row: t.members[0]!.row,
        message: `Equipe "${t.label}" tem ${t.members.length} pessoas na planilha (limite ${opts.maxTeamSize}). Todas serão aceitas no check-in.`,
      });
    }
  }
  return { byEmail, all, teams, issues };
}
