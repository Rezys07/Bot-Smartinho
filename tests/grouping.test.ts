import { describe, expect, test } from "bun:test";
import { parseSheet } from "../src/sheets/parse";
import { buildDeclaredGroups, matchLevel } from "../src/teams/grouping";
import { nameTokens } from "../src/teams/normalize";
import { buildFixture } from "./fixtures/inscricoes";

const t = nameTokens;

describe("matchLevel", () => {
  test("níveis", () => {
    expect(matchLevel(t("Caio Dias"), t("CAIO DIAS"))).toBe(3);
    expect(matchLevel(t("Ana Lima"), t("Ana Beatriz Lima"))).toBe(2);
    expect(matchLevel(t("ana beatriz"), t("Ana Beatriz Lima"))).toBe(2);
    expect(matchLevel(t("Érica Fernandes Melo"), t("Erica Fernandes-Melo"))).toBe(3);
    expect(matchLevel(t("Júlia"), t("Julia Moreira"))).toBe(1);
    expect(matchLevel(t("Ana Costa"), t("Ana Beatriz Lima"))).toBe(0);
    expect(matchLevel(t("Bruno Costa"), t("Caio Costa"))).toBe(0);
  });
  test("tolera 1 erro de digitação em palavra longa", () => {
    expect(matchLevel(t("Felipe Rocah"), t("Felipe Rocha"))).toBe(0); // 'rocah' tem 2 trocas
    expect(matchLevel(t("Gustavo Nunez"), t("Gustavo Nunes"))).toBe(3);
  });
});

describe("buildDeclaredGroups (fixture)", () => {
  const sheet = parseSheet(buildFixture());
  const result = buildDeclaredGroups(sheet.all, { maxSize: 5 });
  const groupOf = (nome: string) => result.groups.find((g) => g.members.some((m) => m.nome === nome));
  const namesOf = (nome: string) => groupOf(nome)?.members.map((m) => m.nome) ?? [];
  const issues = (kind: string) => result.issues.filter((i) => i.kind === kind);

  test("equipe formada com separadores variados e autoinclusão", () => {
    expect(namesOf("Ana Beatriz Lima")).toEqual(["Ana Beatriz Lima", "Bruno Henrique Costa", "Caio Dias"]);
    const g = groupOf("Caio Dias")!;
    expect(g.open).toBe(false);
    expect(g.unregistered).toEqual([]);
    expect(g.declaredSize).toBe(3);
  });

  test("individuais não entram em grupos", () => {
    expect(groupOf("Daniela Souza")).toBeUndefined();
    expect(groupOf("Marcos Vieira")).toBeUndefined();
  });

  test("equipe parcial + citado não inscrito + conflito de modo", () => {
    expect(namesOf("Felipe Rocha")).toEqual(["Érica Fernandes-Melo", "Felipe Rocha", "Lucas Ferraz"]);
    const g = groupOf("Felipe Rocha")!;
    expect(g.open).toBe(true);
    expect(g.unregistered).toEqual(["Gustavo Nunes"]);
    expect(g.declaredSize).toBe(4);
    expect(issues("mode_conflict")).toHaveLength(1);
    expect(issues("not_registered").some((i) => i.message.includes("Gustavo Nunes"))).toBe(true);
  });

  test("primeiro nome ambíguo não é decidido pelo bot", () => {
    const amb = issues("ambiguous");
    expect(amb).toHaveLength(1);
    expect(amb[0]!.row).toBe(10);
    expect(amb[0]!.message).toContain("Marcos Vieira");
    expect(amb[0]!.message).toContain("Marcos Teixeira");
    expect(namesOf("Helena Prado")).toEqual(["Helena Prado"]);
  });

  test("citar quem se inscreveu como individual gera alerta e não agrupa", () => {
    const ci = issues("cites_individual");
    expect(ci).toHaveLength(1);
    expect(ci[0]!.message).toContain("Daniela Souza");
  });

  test("só primeiro nome: agrupa se recíproco, senão alerta", () => {
    expect(namesOf("Igor Santana")).toEqual(["Igor Santana", "Júlia Moreira"]);
    expect(namesOf("Karina Alves")).toEqual(["Karina Alves"]);
    expect(issues("weak_match").map((i) => i.row)).toEqual([13]);
  });

  test("equipe declarada acima do limite", () => {
    const g = groupOf("Otávio Ramos")!;
    expect(g.declaredSize).toBe(6);
    expect(issues("oversize")).toHaveLength(1);
  });

  test("byEmail aponta para o grupo e mensagens não têm e-mail", () => {
    expect(result.byEmail.get("pessoa2@exemplo.test")?.id).toBe("G2");
    for (const i of result.issues) expect(i.message).not.toContain("@");
  });

  test("citações repetidas da mesma pessoa não inscrita contam uma vez", () => {
    const sheet2 = parseSheet([
      buildFixture()[0]!,
      ["", "a@x.test", "Rita Lopes", "", "", "", "", "Já tenho uma equipe formada", "2", "Sara Mendes", ""],
      ["", "b@x.test", "Tiago Reis", "", "", "", "", "Já tenho uma equipe formada", "2", "Rita Lopes, Sara, Sara Mendes", ""],
    ]);
    const r = buildDeclaredGroups(sheet2.all, { maxSize: 5 });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.unregistered).toEqual(["Sara Mendes"]);
    expect(r.groups[0]!.declaredSize).toBe(3);
  });
});
