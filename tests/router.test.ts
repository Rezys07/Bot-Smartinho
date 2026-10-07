import { describe, expect, test } from "bun:test";
import { parseCommand } from "../src/commands/router";
import { looseName } from "../src/bot/resources";
import { teamTopic } from "../src/teams/discordGateway";

describe("parseCommand", () => {
  test("nome sem acento/caixa e argumentos", () => {
    expect(parseCommand("!Forçar-Entrada <@1> a@b.com")).toEqual({
      name: "forcar-entrada",
      args: ["<@1>", "a@b.com"],
      rest: "<@1> a@b.com",
    });
    expect(parseCommand("!entrar")).toEqual({ name: "entrar", args: [], rest: "" });
  });
  test("preserva quebras de linha no resto (descrição de mentoria)", () => {
    expect(parseCommand("!queromentoria linha 1\nlinha 2")?.rest).toBe("linha 1\nlinha 2");
  });
  test("não é comando", () => {
    expect(parseCommand("oi")).toBeNull();
    expect(parseCommand("!")).toBeNull();
  });
});

describe("looseName", () => {
  test("ignora emoji, acento e separadores", () => {
    expect(looseName("✅┃Check-in")).toBe(looseName("check-in"));
    expect(looseName("Organização")).toBe("organizacao");
  });
});

describe("teamTopic", () => {
  test("inclui rótulo e desafio", () => {
    const base = { number: 7, sheet_key: "x", sheet_label: "Os Urbanistas", open: 0, text_channel_id: null, voice_channel_id: null, desafio: null, desafio_at: null, created_at: "" };
    expect(teamTopic(base)).toBe("Equipe 007 · Nome na inscrição: Os Urbanistas · Desafio: não escolhido (use !desafio)");
    expect(teamTopic({ ...base, sheet_label: null, desafio: "Mobilidade" })).toBe("Equipe 007 · Desafio: Mobilidade");
  });
});
