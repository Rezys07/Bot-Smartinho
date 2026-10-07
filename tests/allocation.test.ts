import { describe, expect, test } from "bun:test";
import { chooseTeamForIndividual, freeSlots, type TeamSlotInfo } from "../src/teams/allocation";

const t = (number: number, members: number, open = true, reserved = 0): TeamSlotInfo => ({ number, members, open, reserved });

describe("freeSlots", () => {
  test("respeita o máximo", () => {
    expect(freeSlots(t(1, 3), 5)).toBe(2);
    expect(freeSlots(t(1, 5), 5)).toBe(0);
    expect(freeSlots(t(1, 6), 5)).toBe(0); // equipe da planilha acima do limite
  });
  test("equipe fechada não tem vaga", () => {
    expect(freeSlots(t(1, 1, false), 5)).toBe(0);
  });
  test("reserva vaga para quem está na planilha e não chegou", () => {
    expect(freeSlots(t(1, 1, true, 3), 5)).toBe(1);
    expect(freeSlots(t(1, 1, true, 4), 5)).toBe(0);
  });
});

describe("chooseTeamForIndividual", () => {
  test("sem equipes → criar nova", () => {
    expect(chooseTeamForIndividual([], 5)).toBeNull();
  });
  test("prioriza a equipe incompleta mais cheia", () => {
    expect(chooseTeamForIndividual([t(1, 2), t(2, 4), t(3, 3)], 5)).toBe(2);
  });
  test("empate → menor número", () => {
    expect(chooseTeamForIndividual([t(4, 3), t(2, 3)], 5)).toBe(2);
  });
  test("ignora cheias e fechadas", () => {
    expect(chooseTeamForIndividual([t(1, 5), t(2, 1, false)], 5)).toBeNull();
  });
  test("considera vagas reservadas", () => {
    // equipe 1: 1 chegou + 4 reservadas → sem vaga; equipe 2: 2 de 5
    expect(chooseTeamForIndividual([t(1, 1, true, 4), t(2, 2)], 5)).toBe(2);
  });
  test("preenche até o limite e depois pede nova equipe", () => {
    const teams = [t(1, 0)];
    const picks: (number | null)[] = [];
    for (let i = 0; i < 6; i++) {
      const p = chooseTeamForIndividual(teams, 5);
      picks.push(p);
      if (p === null) teams.push(t(teams.length + 1, 1));
      else teams.find((x) => x.number === p)!.members++;
    }
    expect(picks).toEqual([1, 1, 1, 1, 1, null]);
  });
});
