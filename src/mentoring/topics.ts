import { readFileSync } from "node:fs";
import { z } from "zod";
import { normalizeName } from "../teams/normalize";

const schema = z.object({
  temas: z
    .array(
      z.object({
        id: z.string().trim().regex(/^[a-z0-9-]{1,30}$/, "use só letras minúsculas, números e hífen"),
        nome: z.string().trim().min(1).max(100),
        descricao: z.string().trim().max(100).default(""),
        /** Mentores sugeridos para o tema: ID do Discord ou nome (como aparece no servidor). */
        mentores: z.array(z.string().trim().min(1)).default([]),
      }),
    )
    .min(1)
    .max(24), // select menu do Discord aceita 25 opções; 1 fica para "Outro assunto"
});

export type Topic = z.infer<typeof schema>["temas"][number];

export const OTHER_TOPIC: Topic = { id: "outro", nome: "Outro assunto", descricao: "Descreva o que vocês precisam", mentores: [] };

export function parseTopics(json: unknown): Topic[] {
  const r = schema.safeParse(json);
  if (!r.success) {
    throw new Error(`config/mentoria.json inválido: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const ids = new Set<string>();
  for (const t of r.data.temas) {
    if (ids.has(t.id) || t.id === OTHER_TOPIC.id) throw new Error(`config/mentoria.json: id repetido ou reservado "${t.id}"`);
    ids.add(t.id);
  }
  return [...r.data.temas, OTHER_TOPIC];
}

export function loadTopics(path: string): Topic[] {
  return parseTopics(JSON.parse(readFileSync(path, "utf8")));
}

export interface MentorCandidate {
  id: string;
  /** Apelido no servidor, nome global e nome de usuário. */
  names: string[];
}

/**
 * Resolve as referências de mentores de um tema (ID ou nome) para IDs.
 * Por nome, aceita só quando exatamente um mentor bate — nunca chuta.
 */
export function resolveMentorRefs(refs: string[], mentors: MentorCandidate[]): { ids: string[]; unresolved: string[] } {
  const ids: string[] = [];
  const unresolved: string[] = [];
  for (const ref of refs) {
    if (/^\d{15,22}$/.test(ref)) {
      if (mentors.some((m) => m.id === ref)) ids.push(ref);
      else unresolved.push(ref);
      continue;
    }
    const q = normalizeName(ref);
    const matches = mentors.filter((m) => m.names.some((n) => normalizeName(n).split(" ").includes(q) || normalizeName(n) === q));
    if (matches.length === 1) ids.push(matches[0]!.id);
    else unresolved.push(ref);
  }
  return { ids: [...new Set(ids)], unresolved };
}
