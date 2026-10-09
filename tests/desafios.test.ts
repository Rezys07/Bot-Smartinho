import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { canSetDesafio, parseDesafios, resolveDesafio } from "../src/teams/desafios";

const list = parseDesafios(JSON.parse(readFileSync("config/desafios.json", "utf8")));

describe("config/desafios.json", () => {
  test("arquivo do projeto é válido", () => {
    expect(list.length).toBeGreaterThanOrEqual(1);
  });
  test("rejeita lista vazia e ids repetidos", () => {
    expect(() => parseDesafios({ desafios: [] })).toThrow();
    expect(() => parseDesafios({ desafios: [{ id: "1", nome: "A" }, { id: "1", nome: "B" }] })).toThrow(/repetido/);
  });
});

describe("resolveDesafio", () => {
  const ds = parseDesafios({
    desafios: [
      { id: "1", nome: "Mobilidade Urbana" },
      { id: "2", nome: "Sustentabilidade" },
      { id: "3", nome: "Serviços Públicos" },
    ],
  });
  test("por id, nome e começo do nome", () => {
    expect(resolveDesafio(ds, "1")?.id).toBe("1");
    expect(resolveDesafio(ds, "  mobilidade urbana ")?.id).toBe("1");
    expect(resolveDesafio(ds, "servicos")?.id).toBe("3");
  });
  test("ambíguo ou inexistente", () => {
    expect(resolveDesafio(ds, "s")).toBeNull(); // Sustentabilidade e Serviços
    expect(resolveDesafio(ds, "9")).toBeNull();
    expect(resolveDesafio(ds, "")).toBeNull();
  });
});

describe("canSetDesafio", () => {
  const deadline = new Date("2026-10-10T12:00:00-03:00");
  const before = new Date("2026-10-10T11:00:00-03:00");
  const after = new Date("2026-10-10T13:00:00-03:00");
  test("primeira escolha sempre aceita", () => {
    expect(canSetDesafio({ current: null, next: "1", deadline, now: after, isOrganizacao: false })).toBe("allowed");
  });
  test("troca só até o prazo", () => {
    expect(canSetDesafio({ current: "1", next: "2", deadline, now: before, isOrganizacao: false })).toBe("allowed");
    expect(canSetDesafio({ current: "1", next: "2", deadline, now: after, isOrganizacao: false })).toBe("deadline_passed");
  });
  test("sem prazo, troca livre; organização sempre pode", () => {
    expect(canSetDesafio({ current: "1", next: "2", deadline: undefined, now: after, isOrganizacao: false })).toBe("allowed");
    expect(canSetDesafio({ current: "1", next: "2", deadline, now: after, isOrganizacao: true })).toBe("allowed");
  });
  test("mesma escolha", () => {
    expect(canSetDesafio({ current: "1", next: "1", deadline, now: before, isOrganizacao: false })).toBe("same");
  });
});

import { readdirSync, existsSync } from "node:fs";
import { parseTopics } from "../src/mentoring/topics";

describe("todas as pastas de configuração", () => {
  const dirs = ["config", ...readdirSync("config", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `config/${d.name}`)];
  for (const dir of dirs) {
    test(`${dir} tem desafios, temas e mensagem de check-in válidos`, () => {
      expect(parseDesafios(JSON.parse(readFileSync(`${dir}/desafios.json`, "utf8"))).length).toBeGreaterThan(0);
      expect(parseTopics(JSON.parse(readFileSync(`${dir}/mentoria.json`, "utf8"))).length).toBeGreaterThan(1);
      expect(existsSync(`${dir}/mensagem-checkin.md`)).toBe(true);
    });
  }
});

describe("lista de desafios cabe no embed do Discord", () => {
  const dirs = ["config", ...readdirSync("config", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `config/${d.name}`)];
  for (const dir of dirs) {
    test(`${dir}: descrição do embed < 4096 caracteres`, () => {
      const list = parseDesafios(JSON.parse(readFileSync(`${dir}/desafios.json`, "utf8")));
      // Mesmo formato de src/commands/desafio.ts (listEmbed)
      const text = list.map((d) => `✅ **${d.id}. ${d.nome}**${d.descricao ? `\n${d.descricao}` : ""}`).join("\n\n");
      expect(text.length).toBeLessThan(4096);
    });
  }
});
