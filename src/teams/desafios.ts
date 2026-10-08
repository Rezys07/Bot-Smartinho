import { readFileSync } from "node:fs";
import { z } from "zod";
import { normalizeName } from "./normalize";

const schema = z.object({
  desafios: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        nome: z.string().trim().min(1),
        descricao: z.string().trim().default(""),
      }),
    )
    .min(1, "informe pelo menos um desafio"),
});

export type Desafio = z.infer<typeof schema>["desafios"][number];

export function parseDesafios(json: unknown): Desafio[] {
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new Error(`config/desafios.json inválido: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const ids = new Set<string>();
  for (const d of result.data.desafios) {
    const key = normalizeName(d.id);
    if (ids.has(key)) throw new Error(`config/desafios.json: id repetido "${d.id}"`);
    ids.add(key);
  }
  return result.data.desafios;
}

export function loadDesafios(path: string): Desafio[] {
  return parseDesafios(JSON.parse(readFileSync(path, "utf8")));
}

/** Aceita o id ("1"), o nome completo ou o começo do nome ("mobilidade"). */
export function resolveDesafio(list: Desafio[], input: string): Desafio | null {
  const q = normalizeName(input);
  if (!q) return null;
  const byId = list.find((d) => normalizeName(d.id) === q);
  if (byId) return byId;
  const byName = list.find((d) => normalizeName(d.nome) === q);
  if (byName) return byName;
  const prefix = list.filter((d) => normalizeName(d.nome).startsWith(q));
  return prefix.length === 1 ? prefix[0]! : null;
}

export type ChangeDecision = "allowed" | "same" | "deadline_passed";

/**
 * Regras de escolha: a primeira escolha é sempre aceita; trocar só até o prazo.
 * A organização pode trocar a qualquer momento.
 */
export function canSetDesafio(opts: {
  current: string | null;
  next: string;
  deadline: Date | undefined;
  now: Date;
  isOrganizacao: boolean;
}): ChangeDecision {
  if (opts.current === opts.next) return "same";
  if (opts.current === null || opts.isOrganizacao) return "allowed";
  if (opts.deadline && opts.now > opts.deadline) return "deadline_passed";
  return "allowed";
}

export function formatDeadline(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}
