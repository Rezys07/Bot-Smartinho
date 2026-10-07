import { describe, expect, test } from "bun:test";
import {
  editDistance,
  isValidEmail,
  nameTokens,
  normalizeEmail,
  normalizeName,
  shortName,
  tokensMatch,
} from "../src/teams/normalize";

describe("normalizeEmail", () => {
  test("trim e minúsculas", () => {
    expect(normalizeEmail("  Fulano.Teste@Exemplo.COM \n")).toBe("fulano.teste@exemplo.com");
  });
  test("remove caracteres invisíveis, mailto e <>", () => {
    expect(normalizeEmail("​mailto:a@b.com﻿")).toBe("a@b.com");
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
  test("nameTokens remove partículas e números", () => {
    expect(nameTokens("Maria da Conceição dos Santos")).toEqual(["maria", "conceicao", "santos"]);
    expect(nameTokens("1. José")).toEqual(["jose"]);
  });
  test("shortName", () => {
    expect(shortName("maria clara da silva santos")).toBe("Maria Santos");
    expect(shortName("JOÃO")).toBe("João");
    expect(shortName("Ana-clara Souza de")).toBe("Ana-Clara Souza");
  });
});

describe("tolerância a erro de digitação", () => {
  test("editDistance", () => {
    expect(editDistance("oliveira", "olivera")).toBe(1);
    expect(editDistance("abc", "xyz", 1)).toBe(2);
  });
  test("tokensMatch só aceita 1 erro em palavras de 5+ letras", () => {
    expect(tokensMatch("oliveira", "olivera")).toBe(true);
    expect(tokensMatch("ana", "ane")).toBe(false);
    expect(tokensMatch("souza", "sousa")).toBe(true);
    expect(tokensMatch("pedro", "paulo")).toBe(false);
  });
});
