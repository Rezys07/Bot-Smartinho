import { describe, expect, test } from "bun:test";
import pino from "pino";
import type { SheetSource } from "../src/sheets/client";
import { InscricoesStore } from "../src/sheets/store";
import { withRetry } from "../src/util/retry";
import { buildFixture } from "./fixtures/inscricoes";

const silent = pino({ level: "silent" });

class FakeSource implements SheetSource {
  calls = 0;
  constructor(public next: () => unknown[][]) {}
  async fetchValues() {
    this.calls++;
    return this.next();
  }
}

describe("InscricoesStore", () => {
  test("carrega e busca por e-mail normalizado", async () => {
    const store = new InscricoesStore(new FakeSource(buildFixture), { maxTeamSize: 5, refreshMinutes: 5, logger: silent });
    const r = await store.refresh();
    expect(r.ok).toBe(true);
    expect(store.findByEmail("  PESSOA1@Exemplo.Test ")?.nome).toBe("Ana Beatriz Lima");
    expect(store.declaredGroupOf("pessoa3@exemplo.test")?.members).toHaveLength(3);
    expect(store.findByEmail("naoexiste@exemplo.test")).toBeUndefined();
  });

  test("falha da API mantém o cache anterior", async () => {
    let fail = false;
    const src = new FakeSource(() => {
      if (fail) throw new Error("503");
      return buildFixture();
    });
    const store = new InscricoesStore(src, { maxTeamSize: 5, refreshMinutes: 5, logger: silent });
    await store.refresh();
    fail = true;
    const r = await store.refresh();
    expect(r.ok).toBe(false);
    expect(r.snapshot).not.toBeNull();
    expect(store.findByEmail("pessoa1@exemplo.test")).toBeDefined();
  });

  test("planilha vazia não apaga o cache", async () => {
    let empty = false;
    const store = new InscricoesStore(new FakeSource(() => (empty ? [] : buildFixture())), {
      maxTeamSize: 5,
      refreshMinutes: 5,
      logger: silent,
    });
    await store.refresh();
    empty = true;
    expect((await store.refresh()).ok).toBe(false);
    expect(store.findByEmail("pessoa1@exemplo.test")).toBeDefined();
  });

  test("refresh simultâneos fazem uma só leitura", async () => {
    const src = new FakeSource(buildFixture);
    const store = new InscricoesStore(src, { maxTeamSize: 5, refreshMinutes: 5, logger: silent });
    await Promise.all([store.refresh(), store.refresh(), store.refresh()]);
    expect(src.calls).toBe(1);
  });
});

describe("withRetry", () => {
  const sleep = async () => {};
  test("repete até dar certo", async () => {
    let n = 0;
    const v = await withRetry(async () => {
      if (++n < 3) throw new Error("x");
      return "ok";
    }, { sleep });
    expect(v).toBe("ok");
    expect(n).toBe(3);
  });
  test("não repete erro não recuperável", async () => {
    let n = 0;
    await expect(
      withRetry(async () => {
        n++;
        throw new Error("403");
      }, { sleep, shouldRetry: () => false }),
    ).rejects.toThrow("403");
    expect(n).toBe(1);
  });
});
