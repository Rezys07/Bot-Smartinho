import { isValidEmail, normalizeEmail, normalizeName } from "../teams/normalize";
import type { Inscricao, ParsedSheet, ParticipationMode, SheetIssue } from "./types";

type Field =
  | "email"
  | "nome"
  | "telefone"
  | "instituicao"
  | "curso"
  | "areas"
  | "modo"
  | "integrantesQtd"
  | "integrantes";

/** Trechos (normalizados) que identificam cada coluna pelo título — ordem das colunas não importa. */
const HEADER_MATCHERS: Record<Field, string[]> = {
  email: ["endereco de e mail", "e mail", "email"],
  nome: ["nome completo"],
  telefone: ["telefone", "whatsapp"],
  instituicao: ["instituicao"],
  curso: ["curso"],
  areas: ["areas de interesse"],
  modo: ["como voce deseja participar"],
  integrantesQtd: ["quantos integrantes"],
  integrantes: ["nome dos integrantes"],
};

const REQUIRED: Field[] = ["email", "nome", "modo"];

export function mapHeaders(header: string[]): { cols: Partial<Record<Field, number>>; missing: Field[] } {
  const norm = header.map((h) => normalizeName(h ?? ""));
  const cols: Partial<Record<Field, number>> = {};
  const used = new Set<number>();
  // Campos mais específicos primeiro, para "nome dos integrantes" não virar "nome".
  const order: Field[] = ["integrantes", "integrantesQtd", "modo", "areas", "nome", "email", "telefone", "instituicao", "curso"];
  for (const field of order) {
    for (const needle of HEADER_MATCHERS[field]) {
      const idx = norm.findIndex((h, i) => !used.has(i) && h.includes(needle));
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

export function parseMode(raw: string): ParticipationMode | null {
  const s = normalizeName(raw);
  if (!s) return null;
  if (s.includes("individualmente") || s.includes("ser alocad")) return 1;
  if (s.includes("alguns integrantes") || s.includes("completar")) return 3;
  if (s.includes("equipe formada")) return 2;
  return null;
}

export function splitAreas(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((a) => a.trim())
    .filter(Boolean);
}

/** Converte a matriz da planilha (com cabeçalho na 1ª linha) em inscrições indexadas. */
export function parseSheet(values: unknown[][]): ParsedSheet {
  const issues: SheetIssue[] = [];
  const byEmail = new Map<string, Inscricao>();
  const all: Inscricao[] = [];
  if (values.length === 0) {
    issues.push({ kind: "missing_column", message: "Planilha vazia (sem cabeçalho)." });
    return { byEmail, all, issues };
  }

  const header = (values[0] ?? []).map((v) => String(v ?? ""));
  const { cols, missing } = mapHeaders(header);
  for (const f of missing) {
    issues.push({
      kind: "missing_column",
      message: `Coluna não encontrada: ${f}${REQUIRED.includes(f) ? " (obrigatória)" : ""}`,
    });
  }
  if (REQUIRED.some((f) => missing.includes(f))) return { byEmail, all, issues };

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
    if (!nome) {
      issues.push({ kind: "missing_name", row: rowNumber, message: `Linha ${rowNumber}: nome vazio.` });
    }
    const modoRaw = cell(r, "modo");
    const modo = parseMode(modoRaw);
    if (modo === null) {
      issues.push({ kind: "unknown_mode", row: rowNumber, message: `Linha ${rowNumber}: opção de participação não reconhecida.` });
    }

    const insc: Inscricao = {
      row: rowNumber,
      email,
      nome,
      telefone: cell(r, "telefone"),
      instituicao: cell(r, "instituicao"),
      curso: cell(r, "curso"),
      areas: splitAreas(cell(r, "areas")),
      modo,
      integrantesQtdRaw: cell(r, "integrantesQtd"),
      integrantesRaw: cell(r, "integrantes"),
    };

    const previous = byEmail.get(email);
    if (previous) {
      // As respostas do Forms entram em ordem cronológica: a última vale.
      issues.push({
        kind: "duplicate_email",
        row: rowNumber,
        message: `Linhas ${previous.row} e ${rowNumber}: mesma inscrição enviada mais de uma vez; vale a linha ${rowNumber}.`,
      });
      all.splice(all.indexOf(previous), 1);
    }
    byEmail.set(email, insc);
    all.push(insc);
  }
  return { byEmail, all, issues };
}
