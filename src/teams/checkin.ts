import type { ParticipantRow, Repo, TeamRow } from "../db/repo";
import type { InscricoesStore } from "../sheets/store";
import type { Inscricao } from "../sheets/types";
import type { Mutex } from "../util/mutex";
import type { SlidingWindowLimiter } from "../util/rateLimiter";
import { chooseTeamForIndividual } from "./allocation";
import { identityHash } from "./naming";
import { isValidEmail, normalizeEmail } from "./normalize";

/** Efeitos no Discord ligados à equipe (implementado em discordGateway.ts; falso nos testes). */
export interface TeamGateway {
  /** Garante canais de texto e voz da equipe (idempotente). Atualiza o banco. */
  ensureTeamChannels(team: TeamRow): Promise<TeamRow>;
  /** Dá ao membro acesso aos canais da equipe e o anuncia no canal. */
  grantAccess(team: TeamRow, discordId: string): Promise<void>;
  /** Remove o acesso do membro aos canais da equipe. */
  revokeAccess(team: TeamRow, discordId: string): Promise<void>;
}

export type CheckinResult =
  | { kind: "invalid_email"; attemptsLeft: number }
  | { kind: "rate_limited"; retryAfterMin: number }
  | { kind: "sheet_unavailable" }
  | { kind: "not_found"; attemptsLeft: number }
  | { kind: "username_not_found" }
  | { kind: "email_taken"; otherDiscordId: string }
  | { kind: "already"; participant: ParticipantRow; team: TeamRow | null; provisionError?: string }
  | { kind: "ok"; participant: ParticipantRow; team: TeamRow; createdTeam: boolean; provisionError?: string };

export interface CheckinDeps {
  repo: Repo;
  store: InscricoesStore;
  gateway: TeamGateway;
  limiter: SlidingWindowLimiter;
  mutex: Mutex;
  maxTeamSize: number;
  /** Equipes da planilha aceitam individuais? */
  sheetTeamsOpen: boolean;
}

export class CheckinService {
  constructor(private readonly d: CheckinDeps) {}

  /** Fluxo do `!entrar <email>`. Todo o trabalho que altera estado roda sob o mutex. */
  async checkIn(discordId: string, rawEmail: string): Promise<CheckinResult> {
    const { limiter } = this.d;
    if (limiter.isBlocked(discordId)) {
      return { kind: "rate_limited", retryAfterMin: Math.ceil(limiter.retryAfterMs(discordId) / 60_000) };
    }

    return this.d.mutex.run(async () => {
      const { repo, store } = this.d;
      const existing = repo.participant(discordId);
      // Idempotente: só reenvia a equipe (e corrige canais/acesso se algo falhou antes).
      if (existing) return this.already(existing, discordId);

      const email = normalizeEmail(rawEmail);
      if (!isValidEmail(email)) return { kind: "invalid_email", attemptsLeft: limiter.hit(discordId) };

      if (!store.snapshot) return { kind: "sheet_unavailable" };
      const insc = store.findByEmail(email);
      if (!insc) return { kind: "not_found", attemptsLeft: limiter.hit(discordId) };

      const owner = repo.participantByEmailHash(identityHash(insc));
      if (owner) return { kind: "email_taken", otherDiscordId: owner.discord_id };

      limiter.reset(discordId);
      return this.admit(discordId, insc, { forced: false });
    });
  }

  /**
   * Check-in pelo usuário do Discord (sem digitar nada). Não conta tentativa: a pessoa não escolhe o usuário,
   * então não serve para descobrir inscrições alheias.
   */
  async checkInByUsername(discordId: string, username: string): Promise<CheckinResult> {
    return this.d.mutex.run(async () => {
      const { repo, store } = this.d;
      const existing = repo.participant(discordId);
      if (existing) return this.already(existing, discordId);
      if (!store.snapshot) return { kind: "sheet_unavailable" };
      const insc = store.findByUsername(username);
      if (!insc) return { kind: "username_not_found" };
      const owner = repo.participantByEmailHash(identityHash(insc));
      if (owner) return { kind: "email_taken", otherDiscordId: owner.discord_id };
      return this.admit(discordId, insc, { forced: false });
    });
  }

  private async already(existing: ParticipantRow, discordId: string): Promise<CheckinResult> {
    const { repo } = this.d;
    const team = existing.team_number ? repo.team(existing.team_number) : null;
    const provisionError = team ? await this.provision(team, discordId) : undefined;
    return { kind: "already", participant: existing, team: team ? repo.team(team.number) : null, provisionError };
  }

  /**
   * Cria antecipadamente (banco + canais privados) todas as equipes da coluna Equipe da planilha,
   * na ordem em que aparecem. Idempotente; roda sob o mesmo mutex do check-in.
   * Ninguém ganha acesso aqui — cada pessoa entra no canal da sua equipe ao fazer check-in.
   */
  async ensureDeclaredTeams(): Promise<{ created: TeamRow[]; errors: string[] }> {
    return this.d.mutex.run(async () => {
      const { repo, store, gateway, sheetTeamsOpen } = this.d;
      const created: TeamRow[] = [];
      const errors: string[] = [];
      const declared = [...(store.snapshot?.sheet.teams.values() ?? [])].sort(
        (a, b) => a.members[0]!.row - b.members[0]!.row,
      );
      for (const d of declared) {
        let team = repo.teamBySheetKey(d.key);
        if (!team) {
          team = repo.createTeam({ sheetKey: d.key, sheetLabel: d.label, open: sheetTeamsOpen });
          created.push(team);
        }
        if (team.text_channel_id && team.voice_channel_id) continue;
        try {
          await gateway.ensureTeamChannels(team);
        } catch (err) {
          errors.push(`${d.label}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return { created, errors };
    });
  }

  /**
   * Coloca a pessoa numa equipe e registra o check-in. Deve rodar sob o mutex.
   * Usado também pelo `!forcar-entrada`.
   */
  async admit(discordId: string, insc: Inscricao, opts: { forced: boolean }): Promise<CheckinResult & { kind: "ok" }> {
    const { repo } = this.d;
    const { team, created } = repo.transaction(() => {
      const r = this.pickTeam(insc);
      repo.insertParticipant({
        discordId,
        emailHash: identityHash(insc),
        displayName: insc.nome,
        teamNumber: r.team.number,
        forced: opts.forced,
      });
      return r;
    });
    const provisionError = await this.provision(team, discordId);
    return {
      kind: "ok",
      participant: repo.participant(discordId)!,
      team: repo.team(team.number)!,
      createdTeam: created,
      provisionError,
    };
  }

  /** Decide a equipe (dentro da transação). */
  private pickTeam(insc: Inscricao): { team: TeamRow; created: boolean } {
    const { repo, store, maxTeamSize, sheetTeamsOpen } = this.d;

    if (insc.equipeKey) {
      const existing = repo.teamBySheetKey(insc.equipeKey);
      if (existing) return { team: existing, created: false };
      const declared = store.declaredTeam(insc.equipeKey);
      const team = repo.createTeam({
        sheetKey: insc.equipeKey,
        sheetLabel: declared?.label ?? insc.equipe,
        open: sheetTeamsOpen,
      });
      return { team, created: true };
    }

    const slots = repo.teamsWithCounts().map((t) => ({
      number: t.number,
      open: t.open === 1,
      members: t.members,
      reserved: t.open === 1 ? this.pendingDeclared(t.sheet_key) : 0,
    }));
    const chosen = chooseTeamForIndividual(slots, maxTeamSize);
    if (chosen !== null) return { team: repo.team(chosen)!, created: false };
    return { team: repo.createTeam({ sheetKey: null, sheetLabel: null, open: true }), created: true };
  }

  /** Quantas pessoas da planilha dessa equipe ainda não fizeram check-in. */
  pendingDeclared(sheetKey: string | null): number {
    const declared = this.d.store.declaredTeam(sheetKey)?.members ?? [];
    return declared.filter((m) => !this.d.repo.participantByEmailHash(identityHash(m))).length;
  }

  /** Canais + acesso no Discord. Falhas não desfazem o check-in; são reportadas e corrigidas no próximo `!entrar`. */
  private async provision(team: TeamRow, discordId: string): Promise<string | undefined> {
    try {
      const withChannels = await this.d.gateway.ensureTeamChannels(team);
      await this.d.gateway.grantAccess(withChannels, discordId);
      return undefined;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }
}
