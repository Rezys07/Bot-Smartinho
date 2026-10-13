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
  let hasEmailColumn = cols.email !== undefined;
  let emailsInUserColumn = 0;
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
  /** E-mail extra de uma linha (ex.: e-mail colocado na coluna de usuário além da coluna de e-mail). */
  const altEmail = new Map<Inscricao, string>();
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
    let userRaw = cell(r, "usuario");
    // Coluna "usuário" preenchida com e-mail: aproveita como e-mail (check-in pede o e-mail na janela).
    // Se a linha já tem e-mail, esse vira um segundo e-mail aceito para a mesma pessoa.
    let extraEmail: string | null = null;
    if (userRaw.includes("@") && isValidEmail(normalizeEmail(userRaw))) {
      const fromUser = normalizeEmail(userRaw);
      if (!email) email = fromUser;
      else if (fromUser !== email) extraEmail = fromUser;
      emailsInUserColumn++;
      userRaw = "";
    }
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
    const insc: Inscricao = { row: rowNumber, email, usuario, nome, equipe: equipeRaw || null, equipeKey: teamKey(equipeRaw) };
    rows.push(insc);
    if (extraEmail) altEmail.set(insc, extraEmail);
  }

  if (emailsInUserColumn > 0) {
    hasEmailColumn = true;
    issues.push({
      kind: "invalid_username",
      message: `${emailsInUserColumn} linha(s) com e-mail na coluna de usuário: tratadas como e-mail (essas pessoas digitam o e-mail no check-in).`,
    });
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

  // E-mails extras só valem se não forem o e-mail principal de outra pessoa (a identidade continua sendo o principal).
  for (const [insc, alt] of altEmail) {
    if (!byEmail.has(alt) && insc.email && byEmail.get(insc.email) === insc) byEmail.set(alt, insc);
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
