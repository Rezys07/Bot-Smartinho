import { normalizeName } from "../teams/normalize";

export type StaffRole = "mentor" | "organizacao";

export interface StaffEntry {
  row: number;
  nome: string;
  usuario: string;
  hackathon: string;
  role: StaffRole;
}

export interface StaffIssue {
  row?: number;
  message: string;
}

export interface ParsedStaff {
  /** Indexado pelo usuário do Discord normalizado. */
  byUsername: Map<string, StaffEntry>;
  issues: StaffIssue[];
}

/**
 * "@Fulano#0", " fulano " → "fulano". Usuários do Discord são minúsculos e únicos.
 * Espaços internos NÃO são removidos: "Carla Dias" é um nome de exibição, não o usuário "carladias"
 * (removê-los deixaria outra pessoa com esse usuário fazer o check-in no lugar dela).
 */
export function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .replace(/^@\s*/, "")
    .replace(/#0+$/, "")
    .toLowerCase();
}

/** Usuários do Discord: 2–32 caracteres, letras minúsculas, números, "_" e "." */
export const isValidUsername = (u: string) => /^[a-z0-9_.]{2,32}$/.test(u);

/** "Os dois" vale para qualquer hackathon. Filtro vazio aceita todos. */
export function hackathonMatches(value: string, filter: string[]): boolean {
  if (filter.length === 0) return true;
  const v = normalizeName(value);
  if (v === "os dois" || v === "ambos" || v === "todos") return true;
  return filter.some((f) => normalizeName(f) === v);
}

/** Lê a planilha de staff (colunas: Nome, usuário, Qual hackathon — em qualquer ordem). */
export function parseStaffSheet(
  values: unknown[][],
  opts: { organizacao: string[]; hackathons: string[] },
): ParsedStaff {
  const byUsername = new Map<string, StaffEntry>();
  const issues: StaffIssue[] = [];
  const header = (values[0] ?? []).map((h) => normalizeName(String(h ?? "")));
  const col = (...needles: string[]) => header.findIndex((h) => needles.some((n) => h.includes(n)));
  const cUser = col("usuario", "user", "discord");
  const cNome = col("nome");
  const cHack = col("hackathon");
  if (cUser < 0) {
    issues.push({ message: "Planilha de staff: coluna 'usuário' não encontrada." });
    return { byUsername, issues };
  }
  const orgSet = new Set(opts.organizacao.map(normalizeUsername));

  for (let i = 1; i < values.length; i++) {
    const r = values[i] ?? [];
    const row = i + 1;
    const usuario = normalizeUsername(String(r[cUser] ?? ""));
    if (!usuario) continue;
    if (!isValidUsername(usuario)) {
      issues.push({ row, message: `Planilha de staff, linha ${row}: usuário "${usuario}" não parece um usuário do Discord.` });
      continue;
    }
    const hackathon = cHack >= 0 ? String(r[cHack] ?? "").trim() : "";
    if (!hackathonMatches(hackathon, opts.hackathons)) continue;
    byUsername.set(usuario, {
      row,
      nome: cNome >= 0 ? String(r[cNome] ?? "").trim() : "",
      usuario,
      hackathon,
      role: orgSet.has(usuario) ? "organizacao" : "mentor",
    });
  }
  for (const u of orgSet) {
    if (!byUsername.has(u)) issues.push({ message: `ORGANIZACAO_USUARIOS: "${u}" não está na planilha de staff (ou foi filtrado).` });
  }
  return { byUsername, issues };
}
