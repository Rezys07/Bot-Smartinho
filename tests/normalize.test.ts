import { describe, expect, test } from "bun:test";
import { isValidEmail, normalizeEmail, normalizeName, shortName } from "../src/teams/normalize";

describe("normalizeEmail", () => {
  test("trim e minúsculas", () => {
    expect(normalizeEmail("  Fulano.Teste@Exemplo.COM \n")).toBe("fulano.teste@exemplo.com");
  });
  test("remove caracteres invisíveis, mailto e <>", () => {
    expect(normalizeEmail(String.fromCharCode(0x200b) + "mailto:a@b.com" + String.fromCharCode(0xfeff))).toBe("a@b.com");
    expect(normalizeEmail("<a@b.com>")).toBe("a@b.com");
  });
  test("remove espaços internos colados por engano", () => {
    expect(normalizeEmail("ana silva@exemplo.com")).toBe("anasilva@exemplo.com");
  });
  test("isValidEmail", () => {
    expect(isValidEmail("a@b.com")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("ab.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("normalizeName", () => {
  test("acentos, caixa, hífens e pontuação", () => {
    expect(normalizeName("  JOÃO-Pedro  d'Ávila ")).toBe("joao pedro d avila");
    expect(normalizeName("Ana Clara.")).toBe("ana clara");
  });
  test("shortName", () => {
    expect(shortName("maria clara da silva santos")).toBe("Maria Santos");
    expect(shortName("JOÃO")).toBe("João");
    expect(shortName("Ana-clara Souza de")).toBe("Ana-Clara Souza");
  });
});
