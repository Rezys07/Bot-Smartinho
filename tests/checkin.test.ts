import { describe, expect, test } from "bun:test";
import pino from "pino";
import { openDatabase } from "../src/db";
import { Repo, type TeamRow } from "../src/db/repo";
import { InscricoesStore } from "../src/sheets/store";
import { CheckinService, type TeamGateway } from "../src/teams/checkin";
import { Mutex } from "../src/util/mutex";
import { SlidingWindowLimiter } from "../src/util/rateLimiter";
import { buildFixture, HEADER } from "./fixtures/inscricoes";

class FakeGateway implements TeamGateway {
  created: number[] = [];
  access: [number, string][] = [];
  fail = false;
  constructor(private repo: Repo) {}
  async ensureTeamChannels(team: TeamRow) {
    if (this.fail) throw new Error("Missing Permissions");
    if (!team.text_channel_id) {
      // simula latência para expor condições de corrida
      await new Promise((r) => setTimeout(r, 5));
      this.created.push(team.number);
      this.repo.setTeamChannels(team.number, `t${team.number}`, `v${team.number}`);
    }
    return this.repo.team(team.number)!;
  }
  async grantAccess(team: TeamRow, id: string) {
    this.access.push([team.number, id]);
  }
  async revokeAccess() {}
}

async function setup(values: unknown[][] = buildFixture(), opts: { sheetTeamsOpen?: boolean; max?: number } = {}) {
  const repo = new Repo(openDatabase(":memory:"));
  const store = new InscricoesStore(
    { fetchValues: async () => values },
    { maxTeamSize: opts.max ?? 5, refreshMinutes: 5, logger: pino({ level: "silent" }) },
  );
  await store.refresh();
  const gateway = new FakeGateway(repo);
  const service = new CheckinService({
    repo,
    store,
    gateway,
    limiter: new SlidingWindowLimiter(3, 60_000),
    mutex: new Mutex(),
    maxTeamSize: opts.max ?? 5,
    sheetTeamsOpen: opts.sheetTeamsOpen ?? false,
  });
  return { repo, store, gateway, service };
}

describe("CheckinService", () => {
  test("equipe da planilha: primeiro cria, demais entram", async () => {
    const { service, gateway } = await setup();
    const a = await service.checkIn("u1", "pessoa1@exemplo.test");
    const b = await service.checkIn("u2", "PESSOA2@exemplo.test");
    expect(a.kind).toBe("ok");
    expect(b.kind).toBe("ok");
    if (a.kind !== "ok" || b.kind !== "ok") return;
    expect(a.createdTeam).toBe(true);
    expect(b.createdTeam).toBe(false);
    expect(b.team.number).toBe(a.team.number);
    expect(a.team.sheet_label).toBe("Equipe 07");
    expect(a.team.open).toBe(0);
    expect(gateway.created).toEqual([1]);
    expect(gateway.access).toEqual([[1, "u1"], [1, "u2"]]);
  });

  test("idempotente: mesmo usuário repetindo", async () => {
    const { service, repo } = await setup();
    await service.checkIn("u1", "pessoa1@exemplo.test");
    const again = await service.checkIn("u1", "pessoa1@exemplo.test");
    expect(again.kind).toBe("already");
    // Mesmo com outro e-mail, só reenvia a equipe atual.
    expect((await service.checkIn("u1", "pessoa5@exemplo.test")).kind).toBe("already");
    expect(repo.countParticipants()).toBe(1);
  });

  test("e-mail já usado por outra conta", async () => {
    const { service } = await setup();
    await service.checkIn("u1", "pessoa1@exemplo.test");
    const r = await service.checkIn("u2", " Pessoa1@Exemplo.test");
    expect(r).toEqual({ kind: "email_taken", otherDiscordId: "u1" });
  });

  test("não encontrado conta tentativas e bloqueia", async () => {
    const { service } = await setup();
    expect(await service.checkIn("u9", "x@exemplo.test")).toEqual({ kind: "not_found", attemptsLeft: 2 });
    expect(await service.checkIn("u9", "invalido")).toEqual({ kind: "invalid_email", attemptsLeft: 1 });
    expect(await service.checkIn("u9", "y@exemplo.test")).toEqual({ kind: "not_found", attemptsLeft: 0 });
    const blocked = await service.checkIn("u9", "pessoa1@exemplo.test");
    expect(blocked.kind).toBe("rate_limited");
  });

  test("individuais preenchem equipe do bot até o limite", async () => {
    const rows = [HEADER, ...Array.from({ length: 7 }, (_, i) => [`Pessoa ${i}`, `i${i}@exemplo.test`, ""])];
    const { service } = await setup(rows, { max: 3 });
    const teams: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await service.checkIn(`u${i}`, `i${i}@exemplo.test`);
      if (r.kind !== "ok") throw new Error(r.kind);
      teams.push(r.team.number);
    }
    expect(teams).toEqual([1, 1, 1, 2, 2, 2, 3]);
  });

  test("individual não entra em equipe fechada da planilha", async () => {
    const { service } = await setup();
    await service.checkIn("u1", "pessoa1@exemplo.test"); // equipe 1 (planilha, fechada)
    const ind = await service.checkIn("u4", "pessoa4@exemplo.test");
    expect(ind.kind === "ok" && ind.team.number).toBe(2);
  });

  test("equipe da planilha aberta recebe individuais respeitando vagas reservadas", async () => {
    const { service } = await setup(undefined, { sheetTeamsOpen: true, max: 4 });
    await service.checkIn("u1", "pessoa1@exemplo.test"); // Equipe 07: 3 declarados → 1 vaga
    const a = await service.checkIn("u4", "pessoa4@exemplo.test");
    const b = await service.checkIn("u7", "pessoa7@exemplo.test");
    expect(a.kind === "ok" && a.team.number).toBe(1);
    expect(b.kind === "ok" && b.team.number).toBe(2);
  });

  test("check-ins simultâneos não duplicam equipe nem canais", async () => {
    const { service, gateway, repo } = await setup();
    const results = await Promise.all([
      service.checkIn("u1", "pessoa1@exemplo.test"),
      service.checkIn("u2", "pessoa2@exemplo.test"),
      service.checkIn("u3", "pessoa3@exemplo.test"),
      service.checkIn("u1b", "pessoa1@exemplo.test"),
    ]);
    expect(results.map((r) => r.kind)).toEqual(["ok", "ok", "ok", "email_taken"]);
    expect(repo.teamsWithCounts()).toHaveLength(1);
    expect(gateway.created).toEqual([1]);
  });

  test("falha no Discord não desfaz o check-in e é corrigida no próximo !entrar", async () => {
    const { service, gateway } = await setup();
    gateway.fail = true;
    const r = await service.checkIn("u1", "pessoa1@exemplo.test");
    expect(r.kind === "ok" && r.provisionError).toContain("Missing Permissions");
    gateway.fail = false;
    const again = await service.checkIn("u1", "pessoa1@exemplo.test");
    expect(again.kind === "already" && again.provisionError).toBeUndefined();
    expect(gateway.created).toEqual([1]);
  });

  test("planilha indisponível sem cache", async () => {
    const repo = new Repo(openDatabase(":memory:"));
    const store = new InscricoesStore(
      { fetchValues: async () => { throw new Error("503"); } },
      { maxTeamSize: 5, refreshMinutes: 5, logger: pino({ level: "silent" }) },
    );
    await store.refresh();
    const s = new CheckinService({
      repo, store, gateway: new FakeGateway(repo), limiter: new SlidingWindowLimiter(3, 1000), mutex: new Mutex(),
      maxTeamSize: 5, sheetTeamsOpen: false,
    });
    expect((await s.checkIn("u1", "a@b.test")).kind).toBe("sheet_unavailable");
  });
});

describe("check-in pelo usuário do Discord", () => {
  const rows = [
    ["Nome", "E-mail", "Usuário", "Equipe"],
    ["Ana Lima", "ana@x.test", "anadev", "7"],
    ["Bia Souza", "", "bia01", "7"],
  ];

  test("entra pelo usuário, sem e-mail", async () => {
    const { service } = await setup(rows);
    const r = await service.checkInByUsername("u1", "BIA01");
    expect(r.kind).toBe("ok");
  });

  test("usuário fora da planilha não conta tentativa", async () => {
    const { service } = await setup(rows);
    for (let i = 0; i < 5; i++) expect((await service.checkInByUsername("u9", "ninguem")).kind).toBe("username_not_found");
    expect((await service.checkIn("u9", "ana@x.test")).kind).toBe("ok");
  });

  test("mesma inscrição por e-mail e por usuário não pode ser usada por duas contas", async () => {
    const { service } = await setup(rows);
    expect((await service.checkIn("u1", "ana@x.test")).kind).toBe("ok");
    expect(await service.checkInByUsername("u2", "anadev")).toEqual({ kind: "email_taken", otherDiscordId: "u1" });
  });

  test("quem já fez check-in recebe a equipe de novo", async () => {
    const { service } = await setup(rows);
    await service.checkInByUsername("u1", "anadev");
    expect((await service.checkInByUsername("u1", "outro")).kind).toBe("already");
  });
});

describe("criação antecipada das equipes da planilha", () => {
  test("cria todas as equipes declaradas, na ordem da planilha, sem dar acesso a ninguém", async () => {
    const { service, gateway, repo } = await setup();
    const r = await service.ensureDeclaredTeams();
    // fixture: "Equipe 07" (linha 2), "Os Urbanistas" (linha 6), "Grandona" (linha 12)
    expect(r.created.map((t) => t.sheet_label)).toEqual(["Equipe 07", "Os Urbanistas", "Grandona"]);
    expect(gateway.created).toEqual([1, 2, 3]);
    expect(gateway.access).toEqual([]);
    expect(repo.teamsWithCounts().every((t) => t.text_channel_id && t.members === 0)).toBe(true);
  });

  test("idempotente e o check-in entra na equipe já criada", async () => {
    const { service, gateway } = await setup();
    await service.ensureDeclaredTeams();
    expect((await service.ensureDeclaredTeams()).created).toEqual([]);
    expect(gateway.created).toEqual([1, 2, 3]);
    const r = await service.checkIn("u5", "pessoa5@exemplo.test"); // Os Urbanistas
    expect(r.kind === "ok" && r.team.number).toBe(2);
    expect(r.kind === "ok" && r.createdTeam).toBe(false);
  });

  test("falha no Discord é reportada e tentada de novo depois", async () => {
    const { service, gateway } = await setup();
    gateway.fail = true;
    expect((await service.ensureDeclaredTeams()).errors).toHaveLength(3);
    gateway.fail = false;
    const again = await service.ensureDeclaredTeams();
    expect(again.created).toEqual([]);
    expect(gateway.created).toEqual([1, 2, 3]);
  });
});
