import { describe, expect, test } from "bun:test";
import { parseMemberCount, parseMemberList } from "../src/teams/memberList";

const names = (text: string) => parseMemberList(text).map((c) => c.tokens.join(" "));

describe("parseMemberList", () => {
  test("respostas vazias", () => {
    for (const t of ["Sem equipe", "sem equipe.", "Nenhum", "não tenho", "-", "", "N/A"]) {
      expect(names(t)).toEqual([]);
    }
    expect(parseMemberList(null)).toEqual([]);
  });

  test("vírgula, ' e ' e quebra de linha", () => {
    expect(names("Ana Lima, Bruno Costa e Carla Dias")).toEqual(["ana lima", "bruno costa", "carla dias"]);
    expect(names("Ana Lima\nBruno Costa\r\nCarla Dias")).toEqual(["ana lima", "bruno costa", "carla dias"]);
    expect(names("Ana Lima E Bruno Costa")).toEqual(["ana lima", "bruno costa"]);
  });

  test("não quebra partícula 'e' dentro de sobrenome nem hífen sem espaço", () => {
    expect(names("Ana-Clara Souza, Dênis de Melo")).toEqual(["ana clara souza", "denis melo"]);
  });

  test("lista numerada, marcadores e rótulo", () => {
    expect(names("Integrantes: 1. Ana Lima 2) Bruno")).toEqual(["ana lima", "bruno"]);
    expect(names("1- Ana Lima\n2- Bruno Costa\n• Carla")).toEqual(["ana lima", "bruno costa", "carla"]);
  });

  test("ponto e vírgula, barra e traço com espaços", () => {
    expect(names("Ana; Bruno / Carla - Davi")).toEqual(["ana", "bruno", "carla", "davi"]);
  });

  test("remove anotações, 'eu', e-mails, telefones e duplicados", () => {
    expect(names("Ana Lima (eu), eu, Bruno Costa (líder) bruno@x.com, (11) 98888-7777, ANA LIMA")).toEqual([
      "ana lima",
      "bruno costa",
    ]);
  });

  test("mantém o texto original para exibição", () => {
    expect(parseMemberList("  João Pedro ,  Maria")[0]?.raw).toBe("João Pedro");
  });
});

describe("parseMemberCount", () => {
  test("variações", () => {
    expect(parseMemberCount("Sem equipe")).toBe(0);
    expect(parseMemberCount("3")).toBe(3);
    expect(parseMemberCount("4 integrantes")).toBe(4);
    expect(parseMemberCount("Três")).toBe(3);
    expect(parseMemberCount("não sei")).toBeNull();
    expect(parseMemberCount(undefined)).toBeNull();
  });
});
