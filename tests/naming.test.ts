import { describe, expect, test } from "bun:test";
import { buildNickname, categoryIndex, categoryName, emailHash, parseTeamRef, teamName } from "../src/teams/naming";
import { Mutex } from "../src/util/mutex";
import { SlidingWindowLimiter } from "../src/util/rateLimiter";

describe("nomes de equipe e categoria", () => {
  test("teamName / parseTeamRef", () => {
    expect(teamName(7)).toBe("equipe-007");
    for (const v of ["equipe-007", "Equipe 7", "007", "7"]) expect(parseTeamRef(v)).toBe(7);
    expect(parseTeamRef("abc")).toBeNull();
  });
  test("categorias de 25 em 25", () => {
    expect(categoryIndex(1, 25)).toBe(0);
    expect(categoryIndex(25, 25)).toBe(0);
    expect(categoryIndex(26, 25)).toBe(1);
    expect(categoryName(0, 25)).toBe("EQUIPES-001-A-025");
    expect(categoryName(1, 25, true)).toBe("EQUIPES-026-A-050-VOZ");
  });
});

describe("buildNickname", () => {
  test("nome curto + número", () => {
    expect(buildNickname("maria clara da silva santos", 7)).toBe("Maria Santos | 007");
    expect(buildNickname("Ana", null)).toBe("Ana");
  });
  test("nunca passa de 32 caracteres", () => {
    const n = buildNickname("Maximiliana Albuquerquenostradamus Wolfeschlegelsteinhausen", 123);
    expect(n.length).toBeLessThanOrEqual(32);
    expect(n.endsWith(" | 123")).toBe(true);
  });
});

describe("emailHash", () => {
  test("mesmo hash para grafias diferentes do mesmo e-mail", () => {
    expect(emailHash(" A@B.com ")).toBe(emailHash("a@b.com"));
    expect(emailHash("a@b.com")).not.toContain("@");
  });
});

describe("SlidingWindowLimiter", () => {
  test("bloqueia após o máximo e libera depois da janela", () => {
    let now = 0;
    const l = new SlidingWindowLimiter(3, 1000, () => now);
    expect(l.hit("u")).toBe(2);
    l.hit("u");
    expect(l.isBlocked("u")).toBe(false);
    expect(l.hit("u")).toBe(0);
    expect(l.isBlocked("u")).toBe(true);
    expect(l.retryAfterMs("u")).toBe(1000);
    now = 1001;
    expect(l.isBlocked("u")).toBe(false);
  });
});

describe("Mutex", () => {
  test("executa em série e sobrevive a erros", async () => {
    const m = new Mutex();
    const order: number[] = [];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const a = m.run(async () => {
      await sleep(20);
      order.push(1);
    });
    const b = m.run(async () => {
      throw new Error("x");
    });
    const c = m.run(async () => order.push(3));
    await a;
    await expect(b).rejects.toThrow("x");
    await c;
    expect(order).toEqual([1, 3]);
  });
});
