import { nameTokens } from "../teams/normalize";
import type { SheetSource } from "./client";
import { mapHeaders } from "./parse";

/**
 * Formato "grade de times" (Women in STEM): uma aba com blocos "TEAM 01:", "TEAM 02:"… e os nomes
 * das integrantes logo abaixo de cada rótulo, mais uma "WAITING LIST" que NÃO vale para o check-in.
 * O usuário do Discord e o e-mail vêm de outra aba (as respostas do formulário), cruzando pelo nome.
 *
 * O resultado é convertido para o formato padrão (Nome, E-mail, Usuário, Equipe), então o resto do
 * bot (check-in, equipes, canais) funciona sem saber que a planilha é diferente.
 */

export interface GridTeam {
  /** "TEAM 01" */
  label: string;
  number: number;
  members: { name: string; cell: string }[];
}

const TEAM_LABEL = /^(?:team|equipe|time|grupo|group)\s*0*(\d{1,3})\s*:?$/i;
const STOP_LABEL = /^(?:waiting\s*list|lista\s*de\s*espera|fila\s*de\s*espera|reserves?|suplentes?)\b/i;

const text = (v: unknown) => String(v ?? "").trim();
const colName = (c: number) => {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** Lê os blocos de times. Integrantes = células abaixo do rótulo, na mesma coluna, até uma célula vazia. */
export function parseTeamsGrid(values: unknown[][]): GridTeam[] {
  const teams = new Map<number, GridTeam>();
  for (let r = 0; r < values.length; r++) {
    const row = values[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const m = text(row[c]).match(TEAM_LABEL);
      if (!m) continue;
      const number = Number(m[1]);
      // Células mescladas repetem o rótulo na coluna ao lado: fica só a primeira ocorrência.
      if (teams.has(number)) continue;
      const team: GridTeam = { label: `TEAM ${String(number).padStart(2, "0")}`, number, members: [] };
      for (let rr = r + 1; rr < values.length; rr++) {
        const name = text(values[rr]?.[c]);
        if (!name || TEAM_LABEL.test(name) || STOP_LABEL.test(name)) break;
        team.members.push({ name: name.replace(/\s+/g, " "), cell: `${colName(c)}${rr + 1}` });
      }
      teams.set(number, team);
    }
  }
  return [...teams.values()].sort((a, b) => a.number - b.number);
}

interface DirectoryEntry {
  row: number;
  nome: string;
  tokens: string[];
  email: string;
  usuario: string;
}

/** Linhas do formulário (Full Name, Email Address, Discord username…). */
export function parseDirectory(values: unknown[][]): DirectoryEntry[] {
  const { cols } = mapHeaders((values[0] ?? []).map(text));
  if (cols.nome === undefined) return [];
  const out: DirectoryEntry[] = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i] ?? [];
    const nome = text(r[cols.nome]).replace(/\s+/g, " ");
    if (!nome) continue;
    out.push({
      row: i + 1,
      nome,
      tokens: nameTokens(nome),
      email: cols.email !== undefined ? text(r[cols.email]) : "",
      usuario: cols.usuario !== undefined ? text(r[cols.usuario]) : "",
    });
  }
  return out;
}

/**
 * Quão bem o nome do time bate com o nome do formulário:
 * 3 = igual; 2 = mesmo primeiro nome e demais palavras contidas, na ordem; 1 = só o primeiro nome.
 */
export function nameMatchLevel(team: string[], directory: string[], same: (a: string, b: string) => boolean = (a, b) => a === b): 0 | 1 | 2 | 3 {
  if (!team.length || !directory.length || !same(team[0]!, directory[0]!)) return 0;
  if (team.length === directory.length && team.every((t, i) => same(t, directory[i]!))) return 3;
  if (team.length === 1) return 1;
  let j = 1;
  for (let i = 1; i < team.length; i++) {
    while (j < directory.length && !same(directory[j]!, team[i]!)) j++;
    if (j >= directory.length) return 0;
    j++;
  }
  return 2;
}

/** Distância de edição com corte: para cedo quando passa de `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Tolera 1 letra de diferença em palavras de 5+ letras ("Marque" × "Marques"). */
export const similarToken = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 5 && editDistance(a, b, 1) <= 1);

export interface RosterReport {
  teams: number;
  members: number;
  matched: number;
  /** Encontradas só pelo primeiro nome (vale conferir). */
  firstNameOnly: { team: string; name: string }[];
  /** Encontradas com pequena diferença de grafia (1 letra): vale corrigir a planilha. */
  approximate: { team: string; name: string; formName: string }[];
  /** Nome do time não encontrado no formulário: essa pessoa não consegue fazer check-in. */
  notFound: { team: string; name: string }[];
  /** Nome bate com mais de uma pessoa do formulário: não validado. */
  ambiguous: { team: string; name: string; candidates: number }[];
  /** A mesma pessoa aparece em mais de um time: não validada até a planilha ser corrigida. */
  inTwoTeams: { name: string; teams: string[] }[];
}

/** Cruza times × formulário e devolve a planilha no formato padrão + um relatório. */
export function buildRoster(teams: GridTeam[], directoryValues: unknown[][]): { values: string[][]; report: RosterReport } {
  const directory = parseDirectory(directoryValues);
  const values: string[][] = [["Nome", "E-mail", "Usuário", "Equipe"]];
  const report: RosterReport = { teams: teams.length, members: 0, matched: 0, firstNameOnly: [], approximate: [], notFound: [], ambiguous: [], inTwoTeams: [] };
  /** pessoa do formulário → times em que ela foi encontrada (e a linha gerada) */
  const assigned = new Map<string, { teams: string[]; row: string[]; name: string }>();

  for (const team of teams) {
    for (const member of team.members) {
      report.members++;
      const tokens = nameTokens(member.name);
      let best = 0;
      let candidates: DirectoryEntry[] = [];
      let approximate = false;
      for (const fuzzy of [false, true]) {
        for (const d of directory) {
          const level = nameMatchLevel(tokens, d.tokens, fuzzy ? similarToken : undefined);
          if (level > best) {
            best = level;
            candidates = [d];
          } else if (level === best && level > 0) {
            candidates.push(d);
          }
        }
        if (best > 0) {
          approximate = fuzzy;
          break;
        }
      }
      // A mesma pessoa pode ter respondido o formulário mais de uma vez: conta como uma só (vale a última).
      const people = new Map<string, DirectoryEntry>();
      for (const d of candidates) people.set(d.tokens.join(" "), d);
      const unique = [...people.values()];

      if (best === 0) {
        report.notFound.push({ team: team.label, name: member.name });
        continue;
      }
      if (unique.length > 1) {
        report.ambiguous.push({ team: team.label, name: member.name, candidates: unique.length });
        continue;
      }
      const hit = candidates.at(-1)!;
      const key = hit.tokens.join(" ");
      const previous = assigned.get(key);
      if (previous) {
        previous.teams.push(team.label);
        continue;
      }
      if (best === 1) report.firstNameOnly.push({ team: team.label, name: member.name });
      if (approximate) report.approximate.push({ team: team.label, name: member.name, formName: hit.nome });
      const row = [hit.nome, hit.email, hit.usuario, team.label];
      assigned.set(key, { teams: [team.label], row, name: member.name });
      values.push(row);
    }
  }

  // Quem está em mais de um time não é validado: a organização precisa decidir o time certo.
  for (const a of assigned.values()) {
    if (a.teams.length < 2) continue;
    report.inTwoTeams.push({ name: a.name, teams: a.teams });
    values.splice(values.indexOf(a.row), 1);
  }
  report.matched = values.length - 1;
  return { values, report };
}

/** Lê as duas abas (times + formulário) e entrega a planilha já no formato padrão. */
export class TeamsGridSource implements SheetSource {
  lastReport: RosterReport | null = null;

  constructor(
    private readonly teams: SheetSource,
    private readonly directory: SheetSource,
  ) {}

  async fetchValues(): Promise<unknown[][]> {
    const [teamValues, directoryValues] = await Promise.all([this.teams.fetchValues(), this.directory.fetchValues()]);
    const { values, report } = buildRoster(parseTeamsGrid(teamValues), directoryValues);
    this.lastReport = report;
    return values;
  }
}

/** Resumo para o #bot-logs (só nomes e times, nunca e-mail). */
export function formatRosterReport(r: RosterReport): string {
  const lines = [`📋 Planilha de times: ${r.teams} times, ${r.matched}/${r.members} integrantes validadas.`];
  if (r.notFound.length) {
    lines.push(`❗ Não encontradas no formulário (não conseguem fazer check-in):`);
    for (const p of r.notFound) lines.push(`• ${p.team}: ${p.name}`);
  }
  if (r.ambiguous.length) {
    lines.push(`❗ Nome bate com mais de uma pessoa do formulário (não validadas):`);
    for (const p of r.ambiguous) lines.push(`• ${p.team}: ${p.name} (${p.candidates} possibilidades)`);
  }
  if (r.inTwoTeams.length) {
    lines.push(`❗ Pessoa em mais de um time (não validada até corrigir a planilha):`);
    for (const p of r.inTwoTeams) lines.push(`• ${p.name}: ${p.teams.join(" e ")}`);
  }
  if (r.approximate.length) {
    lines.push(`⚠️ Nome com pequena diferença entre Teams e formulário (validadas; vale corrigir):`);
    for (const p of r.approximate) lines.push(`• ${p.team}: "${p.name}" ≈ "${p.formName}"`);
  }
  if (r.firstNameOnly.length) {
    lines.push(`⚠️ Encontradas só pelo primeiro nome (confira):`);
    for (const p of r.firstNameOnly) lines.push(`• ${p.team}: ${p.name}`);
  }
  return lines.join("\n");
}
