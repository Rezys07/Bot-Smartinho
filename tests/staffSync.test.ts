import { describe, expect, test } from "bun:test";
import type { GuildMember } from "discord.js";
import type { BotContext } from "../src/bot/context";
import { openDatabase } from "../src/db";
import { pt } from "../src/i18n/pt";
import { StaffSync } from "../src/staff/sync";

const ROLES = { mentor: { id: "R_MENTOR" }, organizacao: { id: "R_ORG" } };

function fakeMember(username: string, roles: string[]) {
  const cache = new Set(roles);
  return {
    id: `id-${username}`,
    user: { bot: false, username },
    roles: {
      cache: { has: (id: string) => cache.has(id) },
      add: async (r: { id: string }) => void cache.add(r.id),
      remove: async (r: { id: string }) => void cache.delete(r.id),
    },
    send: async () => undefined,
    toString: () => `<@id-${username}>`,
    heldRoles: cache,
  } as unknown as GuildMember & { heldRoles: Set<string> };
}

function setup(organizacao: string[]) {
  const audits: string[] = [];
  const ctx = {
    t: pt,
    env: { ORGANIZACAO_USUARIOS: organizacao, STAFF_HACKATHONS: [] },
    roles: ROLES,
    channels: { filaMentoria: null, botLogs: null, salaMentores: null },
    audit: async (s: string) => void audits.push(s),
  } as unknown as BotContext;
  const sheet = [["Nome", "usuário", "Qual hackathon"], ["Isa", "isabela", "Mulheres"], ["Ana", "ana", "Os dois"]];
  return { ctx, audits, source: { fetchValues: async () => sheet } };
}

describe("StaffSync", () => {
  test("dá o cargo conforme a lista e não repete", async () => {
    const db = openDatabase(":memory:");
    const { ctx, source } = setup(["isabela"]);
    const sync = new StaffSync(ctx, source, db);
    await sync.refresh();
    const isa = fakeMember("isabela", []);
    expect(await sync.apply(isa)).toBe(true);
    expect([...isa.heldRoles]).toEqual(["R_ORG"]);
    expect(await sync.apply(isa)).toBe(false);
  });

  test("Organização → Mentor: remove o cargo que o bot deu e aplica o novo", async () => {
    const db = openDatabase(":memory:");
    const first = setup(["isabela"]);
    const s1 = new StaffSync(first.ctx, first.source, db);
    await s1.refresh();
    const isa = fakeMember("isabela", []);
    await s1.apply(isa);

    const second = setup([]); // isabela saiu da lista de organização
    const s2 = new StaffSync(second.ctx, second.source, db);
    await s2.refresh();
    await s2.apply(isa);
    expect([...isa.heldRoles]).toEqual(["R_MENTOR"]);
    expect(second.audits.some((a) => a.includes("deixou de ser **Organização**"))).toBe(true);
  });

  test("não remove cargo dado à mão (sem registro do bot)", async () => {
    const db = openDatabase(":memory:");
    const { ctx, source } = setup([]);
    const sync = new StaffSync(ctx, source, db);
    await sync.refresh();
    const ana = fakeMember("ana", ["R_ORG"]); // Organização dada manualmente
    await sync.apply(ana);
    expect([...ana.heldRoles].sort()).toEqual(["R_MENTOR", "R_ORG"]);
  });
});
