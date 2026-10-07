import type { Inscricao } from "../sheets/types";
import { parseMemberList, type CitedName } from "./memberList";
import { nameTokens, tokensMatch } from "./normalize";

/**
 * Força do casamento entre um nome citado e o nome de uma inscrição.
 * 3 = nome completo igual; 2 = mesmo primeiro nome + demais palavras contidas;
 * 1 = só o primeiro nome (fraco: só aceito quando a citação é recíproca).
 */
export type MatchLevel = 0 | 1 | 2 | 3;

export function matchLevel(cited: string[], registered: string[]): MatchLevel {
  if (cited.length === 0 || registered.length === 0) return 0;
  if (!tokensMatch(cited[0]!, registered[0]!)) return 0;
  if (cited.length === 1) return 1;
  if (cited.length === registered.length && cited.every((t, i) => tokensMatch(t, registered[i]!))) return 3;
  // Demais palavras citadas aparecem, na ordem, no nome inscrito.
  let j = 1;
  for (let i = 1; i < cited.length; i++) {
    while (j < registered.length && !tokensMatch(cited[i]!, registered[j]!)) j++;
    if (j >= registered.length) return 0;
    j++;
  }
  return 2;
}

export type GroupingIssueKind =
  | "ambiguous"
  | "weak_match"
  | "not_registered"
  | "cites_individual"
  | "mode_conflict"
  | "oversize";

export interface GroupingIssue {
  kind: GroupingIssueKind;
  /** Linha da planilha de quem citou (ou a menor linha do grupo). */
  row: number;
  /** Mensagem para #bot-logs: só nomes e linhas, nunca e-mail/telefone. */
  message: string;
}

export interface DeclaredGroup {
  /** Identificador estável enquanto a menor linha não mudar: "G<linha>". */
  id: string;
  members: Inscricao[];
  /** Nomes citados que não batem com nenhuma inscrição (pode ser gente que ainda vai se inscrever). */
  unregistered: string[];
  /** true se alguém marcou o modo 3 (aceita individuais). */
  open: boolean;
  /** Inscritos + citados não inscritos. */
  declaredSize: number;
}

export interface GroupingResult {
  groups: DeclaredGroup[];
  /** e-mail normalizado → grupo (só para quem está em um grupo declarado). */
  byEmail: Map<string, DeclaredGroup>;
  issues: GroupingIssue[];
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]!]!;
      x = this.parent[x]!;
    }
    return x;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

const isTeamMode = (i: Inscricao) => i.modo === 2 || i.modo === 3;

/**
 * Monta os "grupos declarados" a partir das listas de integrantes.
 * Regra geral: em caso de dúvida, NÃO une — registra um problema para a organização resolver.
 */
export function buildDeclaredGroups(rows: Inscricao[], opts: { maxSize: number }): GroupingResult {
  const issues: GroupingIssue[] = [];
  const tokens = rows.map((r) => nameTokens(r.nome));
  const cites: CitedName[][] = rows.map((r) => (isTeamMode(r) ? parseMemberList(r.integrantesRaw) : []));
  const uf = new UnionFind(rows.length);
  const unregisteredByRow = new Map<number, string[]>();

  const citesBack = (candidate: number, citer: number) =>
    cites[candidate]!.some((c) => matchLevel(c.tokens, tokens[citer]!) >= 1);

  rows.forEach((row, i) => {
    for (const cited of cites[i]!) {
      const levels = rows.map((_, j) => matchLevel(cited.tokens, tokens[j]!));
      const selfLevel = levels[i]!;
      let best = 0;
      levels.forEach((l, j) => {
        if (j !== i && l > best) best = l;
      });

      // O participante costuma se incluir na própria lista.
      if (selfLevel > 0 && selfLevel >= best) continue;

      if (best === 0) {
        (unregisteredByRow.get(i) ?? unregisteredByRow.set(i, []).get(i)!).push(cited.raw);
        continue;
      }

      const candidates = levels.flatMap((l, j) => (j !== i && l === best ? [j] : []));
      let chosen: number | null = null;
      if (candidates.length === 1 && best >= 2) {
        chosen = candidates[0]!;
      } else {
        const reciprocal = candidates.filter((j) => citesBack(j, i));
        if (reciprocal.length === 1) chosen = reciprocal[0]!;
      }

      if (chosen === null) {
        const names = candidates.map((j) => `${rows[j]!.nome} (linha ${rows[j]!.row})`).join(", ");
        issues.push(
          candidates.length === 1
            ? {
                kind: "weak_match",
                row: row.row,
                message: `${row.nome} (linha ${row.row}) citou "${cited.raw}", que pode ser ${names}. Só o primeiro nome bate — não agrupei.`,
              }
            : {
                kind: "ambiguous",
                row: row.row,
                message: `${row.nome} (linha ${row.row}) citou "${cited.raw}", que bate com mais de uma inscrição: ${names}. Não agrupei.`,
              },
        );
        continue;
      }

      const target = rows[chosen]!;
      if (!isTeamMode(target)) {
        issues.push({
          kind: "cites_individual",
          row: row.row,
          message: `${row.nome} (linha ${row.row}) citou ${target.nome} (linha ${target.row}), que se inscreveu como individual. Não agrupei.`,
        });
        continue;
      }
      uf.union(i, chosen);
    }
  });

  // Monta os grupos (só quem é modo 2/3).
  const buckets = new Map<number, number[]>();
  rows.forEach((r, i) => {
    if (!isTeamMode(r)) return;
    const root = uf.find(i);
    (buckets.get(root) ?? buckets.set(root, []).get(root)!).push(i);
  });

  const groups: DeclaredGroup[] = [];
  const byEmail = new Map<string, DeclaredGroup>();
  for (const idxs of buckets.values()) {
    const members = idxs.map((i) => rows[i]!).sort((a, b) => a.row - b.row);
    const unregistered = dedupeNames(idxs.flatMap((i) => unregisteredByRow.get(i) ?? []));
    const modes = new Set(members.map((m) => m.modo));
    const group: DeclaredGroup = {
      id: `G${members[0]!.row}`,
      members,
      unregistered,
      open: modes.has(3),
      declaredSize: members.length + unregistered.length,
    };
    const label = describe(group);

    if (modes.has(2) && modes.has(3)) {
      issues.push({
        kind: "mode_conflict",
        row: members[0]!.row,
        message: `${label}: parte marcou "equipe formada" e parte "equipe parcial". Considerei a equipe aberta para individuais.`,
      });
    }
    for (const name of unregistered) {
      issues.push({
        kind: "not_registered",
        row: members[0]!.row,
        message: `${label}: "${name}" foi citado(a) mas não encontrei inscrição. A vaga fica reservada.`,
      });
    }
    if (group.declaredSize > opts.maxSize) {
      issues.push({
        kind: "oversize",
        row: members[0]!.row,
        message: `${label}: ${group.declaredSize} pessoas declaradas, acima do limite de ${opts.maxSize}.`,
      });
    }
    groups.push(group);
    for (const m of members) byEmail.set(m.email, group);
  }
  groups.sort((a, b) => a.members[0]!.row - b.members[0]!.row);
  return { groups, byEmail, issues };
}

function describe(g: DeclaredGroup): string {
  return `Grupo ${g.id} [${g.members.map((m) => `${m.nome} (linha ${m.row})`).join(", ")}]`;
}

/** Remove citações repetidas da mesma pessoa feitas por integrantes diferentes. */
function dedupeNames(names: string[]): string[] {
  const kept: { raw: string; tokens: string[] }[] = [];
  for (const raw of names) {
    const t = nameTokens(raw);
    const dup = kept.find(
      (k) =>
        matchLevel(t, k.tokens) >= 2 ||
        matchLevel(k.tokens, t) >= 2 ||
        ((t.length === 1 || k.tokens.length === 1) && tokensMatch(t[0] ?? "", k.tokens[0] ?? "")),
    );
    if (dup) {
      if (t.length > dup.tokens.length) Object.assign(dup, { raw, tokens: t });
      continue;
    }
    kept.push({ raw, tokens: t });
  }
  return kept.map((k) => k.raw);
}
