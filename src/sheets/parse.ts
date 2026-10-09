import { isValidUsername, normalizeUsername } from "../staff/parse";
import { isValidEmail, normalizeEmail, normalizeName } from "../teams/normalize";
import type { DeclaredTeam, Inscricao, ParsedSheet, SheetIssue } from "./types";

type Field = "email" | "usuario" | "nome" | "equipe";

/** Trechos (normalizados) que identificam cada coluna pelo título — a ordem das colunas não importa. */
const HEADER_MATCHERS: Record<Field, string[]> = {
  email: ["endereco de e mail", "e mail", "email"],
  usuario: ["usuario", "username", "discord", "user"],
  nome: ["nome completo", "full name", "nome", "name"],
  equipe: ["equipe", "time", "team", "grupo", "group"],
};

/** Ordem de busca: os mais específicos antes ("Nome da equipe" é equipe; "Nome de usuário" é usuário). */
const SEARCH_ORDER: Field[] = ["email", "usuario", "equipe", "nome"];

export function mapHeaders(header: string[]): { cols: Partial<Record<Field, number>>; missing: Field[] } {
  const norm = header.map((h) => normalizeName(h ?? ""));
  const cols: Partial<Record<Field, number>> = {};
  const used = new Set<number>();
  for (const field of SEARCH_ORDER) {
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

const NO_TEAM = new Set(["", "sem equipe", "individual", "nenhuma", "nenhum", "nao", "x", "na", "n a", "no team", "none"]);

/**
 * Normaliza o valor da coluna Equipe para comparar linhas:
 * "Equipe 07", "equipe-7", "7" → "7"; "Os Urbanistas" → "os urbanistas".
 */
export function teamKey(raw: string | null | undefined): string | null {
  const norm = normalizeName(raw ?? "");
  if (NO_TEAM.has(norm)) return null;
  const stripped = norm.replace(/^(equipe|time|grupo|team|group)\s+/, "").trim();
  if (/^\d+$/.test(stripped)) return String(Number(stripped));
  return stripped || null;
}

export function parseSheet(values: unknown[][], opts: { maxTeamSize: number }): ParsedSheet {
  const issues: SheetIssue[] = [];
  const byEmail = new Map<string, Inscricao>();
  const byUsername = new Map<string, Inscricao>();
  const teams = new Map<string, DeclaredTeam>();
  const empty = (hasEmailColumn: boolean): ParsedSheet => ({ byEmail, byUsername, all: [], teams, hasEmailColumn, issues });
  if (values.length === 0) {
    issues.push({ kind: "missing_column", message: "Planilha vazia (sem cabeçalho)." });
    return empty(false);
  }

  const { cols, missing } = mapHeaders((values[0] ?? []).map((v) => String(v ?? "")));
  const hasEmailColumn = cols.email !== undefined;
  if (cols.nome === undefined) issues.push({ kind: "missing_column", message: "Coluna não encontrada: nome (obrigatória)" });
  if (cols.email === undefined && cols.usuario === undefined) {
    issues.push({ kind: "missing_column", message: "Coluna não encontrada: e-mail ou usuário do Discord (precisa de pelo menos uma)" });
  }
  if (missing.includes("equipe")) {
    issues.push({ kind: "missing_column", message: "Coluna não encontrada: equipe (todos serão tratados como individuais)" });
  }
  if (cols.nome === undefined || (cols.email === undefined && cols.usuario === undefined)) return empty(hasEmailColumn);

  const cell = (r: unknown[], f: Field) => {
    const i = cols[f];
    return i === undefined ? "" : String(r[i] ?? "").trim();
  };

  // Primeiro coleta as linhas; e-mail/usuário repetidos: vale a última linha.
  const rows: Inscricao[] = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i] ?? [];
    const rowNumber = i + 1;
    if (r.every((c) => String(c ?? "").trim() === "")) continue;

    const emailRaw = cell(r, "email");
    let email: string | null = emailRaw ? normalizeEmail(emailRaw) : null;
    if (email && !isValidEmail(email)) {
      issues.push({ kind: "invalid_email", row: rowNumber, message: `Linha ${rowNumber}: e-mail inválido.` });
      email = null;
    }
    const userRaw = cell(r, "usuario");
    let usuario: string | null = userRaw ? normalizeUsername(userRaw) : null;
    if (usuario && !isValidUsername(usuario)) {
      issues.push({ kind: "invalid_username", row: rowNumber, message: `Linha ${rowNumber}: usuário do Discord inválido.` });
      usuario = null;
    }
    if (!email && !usuario) {
      // Se já avisou "e-mail/usuário inválido", não repete o aviso.
      if (!emailRaw && !userRaw) {
        issues.push({ kind: "missing_identity", row: rowNumber, message: `Linha ${rowNumber}: sem e-mail nem usuário; ignorada.` });
      }
      continue;
    }
    const nome = cell(r, "nome").replace(/\s+/g, " ");
    if (!nome) issues.push({ kind: "missing_name", row: rowNumber, message: `Linha ${rowNumber}: nome vazio.` });

    const equipeRaw = cell(r, "equipe");
    rows.push({ row: rowNumber, email, usuario, nome, equipe: equipeRaw || null, equipeKey: teamKey(equipeRaw) });
  }

  for (const insc of rows) {
    if (insc.email) {
      const prev = byEmail.get(insc.email);
      if (prev) {
        issues.push({
          kind: "duplicate_email",
          row: insc.row,
          message: `Linhas ${prev.row} e ${insc.row}: mesmo e-mail repetido; vale a linha ${insc.row}.`,
        });
        if (prev.usuario && byUsername.get(prev.usuario) === prev) byUsername.delete(prev.usuario);
      }
      byEmail.set(insc.email, insc);
    }
    if (insc.usuario) {
      const prev = byUsername.get(insc.usuario);
      if (prev) {
        issues.push({
          kind: "duplicate_username",
          row: insc.row,
          message: `Linhas ${prev.row} e ${insc.row}: mesmo usuário do Discord repetido; vale a linha ${insc.row}.`,
        });
        if (prev.email && byEmail.get(prev.email) === prev) byEmail.delete(prev.email);
      }
      byUsername.set(insc.usuario, insc);
    }
  }

  const all = [...new Set([...byEmail.values(), ...byUsername.values()])].sort((a, b) => a.row - b.row);
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
  return { byEmail, byUsername, all, teams, hasEmailColumn, issues };
}
