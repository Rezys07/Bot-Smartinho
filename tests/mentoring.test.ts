import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { openDatabase } from "../src/db";
import { Repo } from "../src/db/repo";
import { MentoringRequests } from "../src/mentoring/requests";
import { OTHER_TOPIC, parseTopics, resolveMentorRefs } from "../src/mentoring/topics";

function setup() {
  const db = openDatabase(":memory:");
  const repo = new Repo(db);
  const t1 = repo.createTeam({ sheetKey: null, sheetLabel: null, open: true });
  const t2 = repo.createTeam({ sheetKey: null, sheetLabel: null, open: true });
  return { db, reqs: new MentoringRequests(db), t1: t1.number, t2: t2.number };
}

const base = (teamNumber: number) => ({ teamNumber, topic: "mvp", description: "Precisamos de ajuda", requestedBy: "u1", requestedMentorId: null });

describe("MentoringRequests", () => {
  test("uma solicitação ativa por equipe", () => {
    const { reqs, t1, t2 } = setup();
    const a = reqs.create(base(t1));
    expect(a.ok).toBe(true);
    const b = reqs.create(base(t1));
    expect(b.ok).toBe(false);
    if (!b.ok && a.ok) expect(b.active.id).toBe(a.request.id);
    expect(reqs.create(base(t2)).ok).toBe(true);
  });

  test("índice do banco também impede duas ativas (defesa extra)", () => {
    const { db, reqs, t1 } = setup();
    reqs.create(base(t1));
    expect(() =>
      db.query("INSERT INTO mentoring_requests (team_number, topic, description, requested_by) VALUES (?, 'x', 'y', 'z')").run(t1),
    ).toThrow();
  });

  test("atender: só o primeiro mentor vence (duplo clique)", () => {
    const { reqs, t1 } = setup();
    const r = reqs.create(base(t1));
    if (!r.ok) throw new Error();
    expect(reqs.claim(r.request.id, "m1").ok).toBe(true);
    const second = reqs.claim(r.request.id, "m2");
    expect(second).toMatchObject({ ok: false, reason: "already_claimed" });
    expect(reqs.get(r.request.id)?.mentor_id).toBe("m1");
  });

  test("finalizar: só quem atendeu (ou forçado), libera nova solicitação", () => {
    const { reqs, t1 } = setup();
    const r = reqs.create(base(t1));
    if (!r.ok) throw new Error();
    expect(reqs.finish(r.request.id, "m1")).toMatchObject({ ok: false, reason: "not_in_progress" });
    reqs.claim(r.request.id, "m1");
    expect(reqs.finish(r.request.id, "m2")).toMatchObject({ ok: false, reason: "not_owner" });
    const done = reqs.finish(r.request.id, "m1");
    expect(done.ok).toBe(true);
    if (done.ok) expect(done.minutes).toBeGreaterThanOrEqual(0);
    expect(reqs.finish(r.request.id, "m1").ok).toBe(false);
    expect(reqs.create(base(t1)).ok).toBe(true);
  });

  test("organização pode finalizar com force", () => {
    const { reqs, t1 } = setup();
    const r = reqs.create(base(t1));
    if (!r.ok) throw new Error();
    reqs.claim(r.request.id, "m1");
    expect(reqs.finish(r.request.id, "org", true).ok).toBe(true);
  });

  test("cancelar só antes do atendimento", () => {
    const { reqs, t1 } = setup();
    const r = reqs.create(base(t1));
    if (!r.ok) throw new Error();
    expect(reqs.cancel(r.request.id)).toBe(true);
    expect(reqs.activeForTeam(t1)).toBeNull();
  });

  test("atrasadas: abertas há mais de X min, avisadas uma vez", () => {
    const { reqs, t1, t2 } = setup();
    const a = reqs.create(base(t1));
    const b = reqs.create(base(t2));
    if (!a.ok || !b.ok) throw new Error();
    reqs.claim(b.request.id, "m1"); // em atendimento não conta
    const later = new Date(Date.now() + 20 * 60_000);
    expect(reqs.overdue(15, later).map((r) => r.id)).toEqual([a.request.id]);
    expect(reqs.overdue(15, new Date())).toEqual([]);
    reqs.markAlerted(a.request.id);
    expect(reqs.overdue(15, later)).toEqual([]);
  });
});

describe("temas", () => {
  test("config/mentoria.json é válido e ganha 'Outro assunto'", () => {
    const topics = parseTopics(JSON.parse(readFileSync("config/mentoria.json", "utf8")));
    expect(topics.at(-1)).toEqual(OTHER_TOPIC);
    expect(topics.find((t) => t.id === "pitch")?.mentores).toEqual([]);
  });
  test("rejeita id repetido ou reservado", () => {
    expect(() => parseTopics({ temas: [{ id: "a", nome: "A" }, { id: "a", nome: "B" }] })).toThrow();
    expect(() => parseTopics({ temas: [{ id: "outro", nome: "X" }] })).toThrow();
  });
});

describe("resolveMentorRefs", () => {
  const mentors = [
    { id: "111111111111111111", names: ["Bruno Teixeira", "brunot"] },
    { id: "222222222222222222", names: ["Ana Souza", "ana.s"] },
    { id: "333333333333333333", names: ["Ana Lima", "analima"] },
  ];
  test("por nome (sem acento/caixa) e por ID", () => {
    expect(resolveMentorRefs(["BRUNOT"], mentors)).toEqual({ ids: ["111111111111111111"], unresolved: [] });
    expect(resolveMentorRefs(["222222222222222222"], mentors).ids).toEqual(["222222222222222222"]);
  });
  test("ambíguo ou inexistente não é resolvido", () => {
    expect(resolveMentorRefs(["Ana"], mentors)).toEqual({ ids: [], unresolved: ["Ana"] });
    expect(resolveMentorRefs(["Fulano"], mentors).unresolved).toEqual(["Fulano"]);
    expect(resolveMentorRefs(["999999999999999999"], mentors).unresolved).toHaveLength(1);
  });
});
