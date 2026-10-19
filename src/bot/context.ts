  import { PermissionFlagsBits, type Client, type Guild, type GuildMember } from "discord.js";
import type { BotEnv } from "../config/env";
import type { Repo } from "../db/repo";
import type { Messages } from "../i18n";
import type { MentoringRequests } from "../mentoring/requests";
import type { Topic } from "../mentoring/topics";
import type { InscricoesStore } from "../sheets/store";
import type { CheckinService } from "../teams/checkin";
import type { Desafio } from "../teams/desafios";
import type { DiscordTeamGateway } from "../teams/discordGateway";
import type { Audit } from "./messaging";
import type { Resources } from "./resources";

export interface BotContext extends Resources {
  client: Client<true>;
  guild: Guild;
  env: BotEnv;
  repo: Repo;
  store: InscricoesStore;
  checkin: CheckinService;
  gateway: DiscordTeamGateway;
  desafios: Desafio[];
  mentoring: MentoringRequests;
  topics: Topic[];
  audit: Audit;
  /** Textos no idioma do servidor. */
  t: Messages;
}

export function isOrganizacao(ctx: BotContext, member: GuildMember | null): boolean {
  if (!member) return false;
  return member.roles.cache.has(ctx.roles.organizacao.id) || member.permissions.has(PermissionFlagsBits.Administrator);
}

export function isMentor(ctx: BotContext, member: GuildMember | null): boolean {
  return !!member?.roles.cache.has(ctx.roles.mentor.id);
}
