import { describe, expect, test } from "bun:test";
import { mapHeaders, parseSheet, teamKey } from "../src/sheets/parse";
import { buildFixture, HEADER } from "./fixtures/inscricoes";

describe("mapHeaders", () => {
  test("encontra as colunas", () => {
    expect(mapHeaders(HEADER)).toEqual({ cols: { email: 1, equipe: 2, nome: 0 }, missing: ["usuario"] });
  });
  test("independe da ordem e aceita variações de título", () => {
    const { cols, missing } = mapHeaders(["Nome da equipe", "Endereço de e-mail", "Nome Completo", "Nome de usuário"]);
    expect(missing).toEqual([]);
    expect(cols).toEqual({ equipe: 0, email: 1, nome: 2, usuario: 3 });
  });
});

describe("teamKey", () => {
  test("variações do mesmo número", () => {
    for (const v of ["Equipe 07", "7", "equipe-7", " EQUIPE 007 ", "Time 7"]) expect(teamKey(v)).toBe("7");
  });
  test("nomes livres", () => {
    expect(teamKey("Os Urbanistas")).toBe("os urbanistas");
    expect(teamKey("os  urbanistas!")).toBe("os urbanistas");
  });
  test("vazio = individual", () => {
    for (const v of ["", "  ", "Sem equipe", "individual", "-", null, undefined]) expect(teamKey(v)).toBeNull();
  });
});

describe("parseSheet", () => {
  const parsed = parseSheet(buildFixture(), { maxTeamSize: 5 });

  test("indexa por e-mail normalizado", () => {
    expect(parsed.byEmail.get("pessoa2@exemplo.test")?.nome).toBe("Bruno Henrique Costa");
  });

  test("agrupa equipes declaradas", () => {
    expect(parsed.teams.get("7")?.members.map((m) => m.nome)).toEqual(["Ana Beatriz Lima", "Bruno Henrique Costa", "Caio Dias"]);
    expect(parsed.teams.get("7")?.label).toBe("Equipe 07");
    expect(parsed.teams.get("os urbanistas")?.members).toHaveLength(2);
    expect(parsed.teams.size).toBe(3);
  });

  test("individuais ficam sem equipe", () => {
    expect(parsed.byEmail.get("pessoa4@exemplo.test")?.equipeKey).toBeNull();
    expect(parsed.byEmail.get("pessoa7@exemplo.test")?.equipeKey).toBeNull();
  });

  test("e-mail duplicado: vale a última linha", () => {
    expect(parsed.byEmail.get("pessoa4@exemplo.test")?.row).toBe(9);
    expect(parsed.all.filter((i) => i.email === "pessoa4@exemplo.test")).toHaveLength(1);
    expect(parsed.issues.some((i) => i.kind === "duplicate_email")).toBe(true);
  });

  test("e-mail inválido vira problema e é ignorado", () => {
    expect(parsed.issues.find((i) => i.kind === "invalid_email")?.row).toBe(10);
    expect(parsed.all).toHaveLength(10);
  });

  test("equipe acima do limite gera alerta", () => {
    const small = parseSheet(buildFixture(), { maxTeamSize: 2 });
    const over = small.issues.filter((i) => i.kind === "oversize_team");
    expect(over.map((i) => i.message.match(/"(.+?)"/)?.[1])).toEqual(["Equipe 07", "Grandona"]);
  });

  test("mensagens de problema não contêm e-mails", () => {
    for (const i of parsed.issues) expect(i.message).not.toContain("@");
  });

  test("coluna obrigatória ausente", () => {
    const r = parseSheet([["Nome"], ["Ana"]], { maxTeamSize: 5 });
    expect(r.all).toHaveLength(0);
    expect(r.issues.map((i) => i.message).join(" ")).toContain("e-mail ou usuário");
  });

  test("sem coluna Equipe: todos individuais, com aviso", () => {
    const r = parseSheet([["Nome", "E-mail"], ["Ana", "a@b.test"]], { maxTeamSize: 5 });
    expect(r.all[0]?.equipeKey).toBeNull();
    expect(r.issues[0]?.message).toContain("individuais");
  });
});

describe("planilha com usuário do Discord", () => {
  test("só nome + usuário (formato Women in STEM)", () => {
    const r = parseSheet(
      [
        ["nome", "usuario"],
        ["Ana", "@Ana.Dev"],
        ["Bia", "bia_01"],
        ["Inválido", "nome com espaço"],
        ["Bia de novo", "BIA_01"],
      ],
      { maxTeamSize: 5 },
    );
    expect(r.hasEmailColumn).toBe(false);
    expect(r.byUsername.get("ana.dev")?.nome).toBe("Ana");
    expect(r.byUsername.get("bia_01")?.row).toBe(5);
    expect(r.all.map((i) => i.row)).toEqual([2, 5]);
    expect(r.issues.map((i) => i.kind).sort()).toEqual(["duplicate_username", "invalid_username", "missing_column"]);
  });

  test("e-mail e usuário na mesma planilha (headers em inglês)", () => {
    const r = parseSheet(
      [
        ["Full name", "Email", "Discord username", "Team"],
        ["Ana", "ana@x.test", "anadev", "Team 3"],
        ["Bia", "", "bia01", ""],
      ],
      { maxTeamSize: 5 },
    );
    expect(r.hasEmailColumn).toBe(true);
    expect(r.byEmail.get("ana@x.test")).toBe(r.byUsername.get("anadev")!);
    expect(r.byUsername.get("bia01")?.email).toBeNull();
    expect(r.teams.get("3")?.members).toHaveLength(1);
  });
});
