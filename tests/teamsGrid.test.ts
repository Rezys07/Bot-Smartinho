import { describe, expect, test } from "bun:test";
import { parseSheet } from "../src/sheets/parse";
import { buildRoster, formatRosterReport, nameMatchLevel, parseTeamsGrid, TeamsGridSource } from "../src/sheets/teamsGrid";
import { nameTokens } from "../src/teams/normalize";

// Mesmo formato da aba "Teams" real (blocos de 2 colunas, rótulos mesclados repetidos), com nomes fictícios.
const TEAMS = [
  ["TEAM 01:", "TEAM 01:", "", "TEAM 03:", "TEAM 03:"],
  ["Ana Lima", "Brazil", "", "Carla Dias", "Greece"],
  ["Bia Souza", "Italy", "", "Duda Reis", "Spain"],
  ["", "", "", "Helena Fonte-Bôa", "Brazil"],
  [],
  ["TEAM 02:", "TEAM 02:"],
  ["ELIS-MARIA", "Greece"],
  ["Fê Nunes", "Brazil"],
  ["Helena Fonte-Boa", "Brazil"],
  ["Pessoa Sumida", "Brazil"],
  [],
  [],
  ["WAITING LIST:"],
  ["Gabi Espera", ""],
  ["Ana Lima", ""],
];

// Formato das respostas do formulário (cabeçalhos em inglês do Google Forms real).
const FORM = [
  ["Carimbo de data/hora", "Full Name", "Email Address", "Phone / WhatsApp Number", "Discord username and tag", "Country", "What skills could you contribute to your team?"],
  ["t", "Ana Lima", "ana@x.test", "000", "@AnaLima", "Brazil", "x"],
  ["t", "Bia de Souza", "bia@x.test", "000", "bia.souza", "Italy", "x"],
  ["t", "Carla Dias", "carla@x.test", "000", "Carla Dias", "Greece", "x"], // usuário inválido (nome de exibição)
  ["t", "Duda Reis", "duda@x.test", "000", "dudareis", "Spain", "x"],
  ["t", "Elis-Maria Papadopoulou", "elis@x.test", "000", "elis_m", "Greece", "x"],
  ["t", "Fê Nunes", "fe@x.test", "000", "fenunes", "Brazil", "x"],
  ["t", "Helena Fonte-Boa", "helena@x.test", "000", "helenafb", "Brazil", "x"],
  ["t", "Helena Fonte-Bôa", "helena@x.test", "000", "helenafb", "Brazil", "x"], // respondeu duas vezes
  ["t", "Gabi Espera", "gabi@x.test", "000", "gabi", "Brazil", "x"], // só na lista de espera
];

describe("parseTeamsGrid", () => {
  test("lê os blocos, ignora o rótulo mesclado repetido e a lista de espera", () => {
    const teams = parseTeamsGrid(TEAMS);
    expect(teams.map((t) => t.label)).toEqual(["TEAM 01", "TEAM 02", "TEAM 03"]);
    expect(teams[0]!.members.map((m) => m.name)).toEqual(["Ana Lima", "Bia Souza"]);
    expect(teams[1]!.members.map((m) => m.name)).toEqual(["ELIS-MARIA", "Fê Nunes", "Helena Fonte-Boa", "Pessoa Sumida"]);
    expect(teams[2]!.members.map((m) => m.cell)).toEqual(["D2", "D3", "D4"]);
    expect(teams.flatMap((t) => t.members).some((m) => m.name === "Gabi Espera")).toBe(false);
  });
});

describe("nameMatchLevel", () => {
  const t = nameTokens;
  test("igual, contido e só primeiro nome", () => {
    expect(nameMatchLevel(t("Fê Nunes"), t("FE NUNES"))).toBe(3);
    expect(nameMatchLevel(t("Bia Souza"), t("Bia de Souza"))).toBe(3); // "de" é ignorado
    expect(nameMatchLevel(t("ELIS-MARIA"), t("Elis-Maria Papadopoulou"))).toBe(2);
    expect(nameMatchLevel(t("Ana"), t("Ana Lima"))).toBe(1);
    expect(nameMatchLevel(t("Ana Costa"), t("Ana Lima"))).toBe(0);
  });
});

describe("buildRoster", () => {
  const { values, report } = buildRoster(parseTeamsGrid(TEAMS), FORM);
  const sheet = parseSheet(values, { maxTeamSize: 5 });

  test("só quem está num time é validado, no time da planilha", () => {
    expect(sheet.byUsername.get("analima")?.equipe).toBe("TEAM 01");
    expect(sheet.byUsername.get("bia.souza")?.equipeKey).toBe("1");
    expect(sheet.byUsername.get("elis_m")?.equipe).toBe("TEAM 02");
    expect(sheet.byUsername.get("dudareis")?.equipeKey).toBe("3");
  });

  test("lista de espera não entra", () => {
    expect(sheet.byUsername.get("gabi")).toBeUndefined();
    expect(sheet.byEmail.get("gabi@x.test")).toBeUndefined();
  });

  test("usuário inválido continua podendo entrar pelo e-mail", () => {
    expect(sheet.byEmail.get("carla@x.test")?.equipe).toBe("TEAM 03");
    expect(sheet.byEmail.get("carla@x.test")?.usuario).toBeNull();
  });

  test("pessoa em dois times não é validada e é reportada", () => {
    expect(sheet.byUsername.get("helenafb")).toBeUndefined();
    expect(report.inTwoTeams).toEqual([{ name: "Helena Fonte-Boa", teams: ["TEAM 02", "TEAM 03"] }]);
  });

  test("relatório", () => {
    expect(report.teams).toBe(3);
    expect(report.members).toBe(9);
    expect(report.notFound).toEqual([{ team: "TEAM 02", name: "Pessoa Sumida" }]);
    expect(report.matched).toBe(6);
    const text = formatRosterReport(report);
    expect(text).toContain("Pessoa Sumida");
    expect(text).toContain("TEAM 02 e TEAM 03");
    expect(text).not.toContain("@");
  });

  test("equipes saem na ordem dos times (TEAM 01 → equipe 1)", () => {
    expect([...sheet.teams.keys()]).toEqual(["1", "2", "3"]);
  });
});

describe("TeamsGridSource", () => {
  test("junta as duas abas e guarda o relatório", async () => {
    const src = new TeamsGridSource({ fetchValues: async () => TEAMS }, { fetchValues: async () => FORM });
    const values = await src.fetchValues();
    expect(values[0]).toEqual(["Nome", "E-mail", "Usuário", "Equipe"]);
    expect(src.lastReport?.matched).toBe(6);
  });
});

describe("pequenas diferenças de grafia", () => {
  test("1 letra a menos no sobrenome ainda valida, com aviso", () => {
    const teams = [["TEAM 01:"], ["Gabi Luiza Marque"]];
    const form = [["Full Name", "Email Address", "Discord username and tag"], ["Gabi Luiza Marques", "g@x.test", "gabim"]];
    const { values, report } = buildRoster(parseTeamsGrid(teams), form);
    expect(values).toHaveLength(2);
    expect(report.approximate).toEqual([{ team: "TEAM 01", name: "Gabi Luiza Marque", formName: "Gabi Luiza Marques" }]);
  });
  test("nome exato tem prioridade sobre o aproximado", () => {
    const teams = [["TEAM 01:"], ["Ana Souza"]];
    const form = [["Full Name", "Discord username and tag"], ["Ana Sousa", "ana1"], ["Ana Souza", "ana2"]];
    const { values, report } = buildRoster(parseTeamsGrid(teams), form);
    expect(values[1]![2]).toBe("ana2");
    expect(report.approximate).toEqual([]);
  });
  test("palavras curtas não têm tolerância", () => {
    const { report } = buildRoster(parseTeamsGrid([["TEAM 01:"], ["Ana Lia"]]), [["Full Name"], ["Ana Lis"]]);
    expect(report.notFound).toHaveLength(1);
  });
});
