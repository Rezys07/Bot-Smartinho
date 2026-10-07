export interface TeamSlotInfo {
  number: number;
  open: boolean;
  /** Já fizeram check-in. */
  members: number;
  /** Pessoas da planilha atribuídas a essa equipe que ainda não fizeram check-in (vagas reservadas). */
  reserved: number;
}

const used = (t: TeamSlotInfo) => t.members + t.reserved;

/** Vagas livres para individuais: o máximo menos quem já entrou e quem tem vaga reservada. */
export function freeSlots(t: TeamSlotInfo, maxSize: number): number {
  if (!t.open) return 0;
  return Math.max(0, maxSize - used(t));
}

/**
 * Escolhe a equipe para um participante individual.
 * Prioriza completar equipes já começadas (a mais cheia primeiro; empate → menor número).
 * Retorna null quando é preciso criar uma equipe nova.
 */
export function chooseTeamForIndividual(teams: TeamSlotInfo[], maxSize: number): number | null {
  let best: TeamSlotInfo | null = null;
  for (const t of teams) {
    if (freeSlots(t, maxSize) <= 0) continue;
    if (!best || used(t) > used(best) || (used(t) === used(best) && t.number < best.number)) best = t;
  }
  return best?.number ?? null;
}
