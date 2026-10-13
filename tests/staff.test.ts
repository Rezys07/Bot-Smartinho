import { describe, expect, test } from "bun:test";
import { hackathonMatches, normalizeUsername, parseStaffSheet } from "../src/staff/parse";

// Estrutura igual à planilha real; nomes e usuários fictícios.
const SHEET = [
  ["Nome", "usuário", "Qual hackathon"],
  ["Ana", "anaorg01", "Cidades inteligentes"],
  ["Bia", " @BiaMulheres ", "Mulheres"],
  ["Caio", "caio.mentor", "Os dois"],
  ["Davi", "davi_mentor", "Cidades inteligentes"],
  ["", "", ""],
  ["Erro", "nome com espaço!", "Cidades inteligentes"],
];

describe("normalizeUsername", () => {
  test("remove @, #0, espaços e caixa", () => {
    expect(normalizeUsername(" @Fulano#0 ")).toBe("fulano");
  });
});

describe("hackathonMatches", () => {
  test("filtro vazio aceita todos; 'Os dois' sempre entra", () => {
    expect(hackathonMatches("Mulheres", [])).toBe(true);
    expect(hackathonMatches("Mulheres", ["Cidades inteligentes"])).toBe(false);
    expect(hackathonMatches("cidades INTELIGENTES", ["Cidades inteligentes"])).toBe(true);
    expect(hackathonMatches("Os dois", ["Cidades inteligentes"])).toBe(true);
  });
});

describe("parseStaffSheet", () => {
  test("organização pela lista; o resto é mentor", () => {
    const r = parseStaffSheet(SHEET, { organizacao: ["AnaOrg01", "biamulheres"], hackathons: [] });
    expect(r.byUsername.get("anaorg01")?.role).toBe("organizacao");
    expect(r.byUsername.get("biamulheres")?.role).toBe("organizacao");
    expect(r.byUsername.get("caio.mentor")?.role).toBe("mentor");
    expect(r.byUsername.size).toBe(4);
    expect(r.issues.map((i) => i.row)).toEqual([7]); // usuário inválido
  });

  test("filtro por hackathon", () => {
    const r = parseStaffSheet(SHEET, { organizacao: [], hackathons: ["Cidades inteligentes"] });
    expect([...r.byUsername.keys()].sort()).toEqual(["anaorg01", "caio.mentor", "davi_mentor"]);
  });

  test("avisa quando alguém da organização não está na planilha", () => {
    const r = parseStaffSheet(SHEET, { organizacao: ["naoexiste"], hackathons: [] });
    expect(r.issues.some((i) => i.message.includes("naoexiste"))).toBe(true);
  });

  test("sem coluna de usuário", () => {
    expect(parseStaffSheet([["Nome"]], { organizacao: [], hackathons: [] }).issues).toHaveLength(1);
  });
});

describe("nome de exibição não vira usuário", () => {
  test("espaços internos tornam o valor inválido", async () => {
    const { isValidUsername } = await import("../src/staff/parse");
    expect(normalizeUsername("Carla Dias")).toBe("carla dias");
    expect(isValidUsername(normalizeUsername("Carla Dias"))).toBe(false);
    expect(normalizeUsername("@ Fulano ")).toBe("fulano");
  });
});

describe("MENTOR_USUARIOS", () => {
  test("mentores extras entram mesmo fora da planilha e do filtro", () => {
    const r = parseStaffSheet(SHEET, { organizacao: [], hackathons: ["Cidades inteligentes"], mentoresExtras: ["@Nova_Mentora", "biamulheres", "nome invalido"] });
    expect(r.byUsername.get("nova_mentora")).toMatchObject({ role: "mentor", row: 0 });
    expect(r.byUsername.get("biamulheres")?.role).toBe("mentor"); // filtrada da planilha, mas está na lista extra
    expect(r.issues.some((i) => i.message.includes("nome invalido"))).toBe(true);
  });
  test("quem já está na planilha mantém o papel de lá", () => {
    const r = parseStaffSheet(SHEET, { organizacao: ["anaorg01"], hackathons: [], mentoresExtras: ["anaorg01"] });
    expect(r.byUsername.get("anaorg01")?.role).toBe("organizacao");
  });
});
