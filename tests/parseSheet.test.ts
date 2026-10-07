import { describe, expect, test } from "bun:test";
import { mapHeaders, parseMode, parseSheet } from "../src/sheets/parse";
import { buildFixture, HEADER, MODO1, MODO2, MODO3 } from "./fixtures/inscricoes";

describe("mapHeaders", () => {
  test("encontra todas as colunas do formulário", () => {
    const { cols, missing } = mapHeaders(HEADER);
    expect(missing).toEqual([]);
    expect(cols.email).toBe(1);
    expect(cols.nome).toBe(2);
    expect(cols.integrantes).toBe(9);
    expect(cols.integrantesQtd).toBe(8);
  });
  test("independe da ordem das colunas", () => {
    const shuffled = [...HEADER].reverse();
    const { cols } = mapHeaders(shuffled);
    expect(shuffled[cols.nome!]).toBe("Nome Completo");
    expect(shuffled[cols.integrantes!]).toBe("Nome dos integrantes da equipe");
  });
});

describe("parseMode", () => {
  test("três opções do formulário", () => {
    expect(parseMode(MODO1)).toBe(1);
    expect(parseMode(MODO2)).toBe(2);
    expect(parseMode(MODO3)).toBe(3);
    expect(parseMode("outra coisa")).toBeNull();
  });
});

describe("parseSheet", () => {
  const parsed = parseSheet(buildFixture());

  test("indexa por e-mail normalizado", () => {
    expect(parsed.byEmail.get("pessoa1@exemplo.test")?.nome).toBe("Ana Beatriz Lima");
  });

  test("e-mail duplicado: vale a última linha", () => {
    expect(parsed.byEmail.get("pessoa4@exemplo.test")?.row).toBe(15);
    expect(parsed.all.filter((i) => i.email === "pessoa4@exemplo.test")).toHaveLength(1);
    expect(parsed.issues.some((i) => i.kind === "duplicate_email")).toBe(true);
  });

  test("e-mail inválido vira problema e é ignorado", () => {
    expect(parsed.issues.find((i) => i.kind === "invalid_email")?.row).toBe(16);
  });

  test("mensagens de problema não contêm e-mails", () => {
    for (const i of parsed.issues) expect(i.message).not.toContain("@");
  });

  test("coluna obrigatória ausente", () => {
    const r = parseSheet([["Nome Completo"], ["Ana"]]);
    expect(r.all).toHaveLength(0);
    expect(r.issues.map((i) => i.message).join(" ")).toContain("email (obrigatória)");
  });

  test("áreas de interesse separadas", () => {
    // linha 5 foi substituída pela 15 (duplicada)
    expect(parsed.byEmail.get("pessoa4@exemplo.test")?.areas).toEqual(["Energia"]);
  });
});
