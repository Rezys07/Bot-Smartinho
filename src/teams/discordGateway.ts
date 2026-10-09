import {
  ChannelType,
  EmbedBuilder,
  type CategoryChannel,
  type Guild,
  type GuildChannel,
  type OverwriteResolvable,
  PermissionFlagsBits as P,
  type Role,
  type TextChannel,
  type VoiceChannel,
} from "discord.js";
import type { Repo, TeamRow } from "../db/repo";
import { logger } from "../logger";
import { looseName } from "../bot/resources";
import type { TeamGateway } from "./checkin";
import { mentoriaButtonRow } from "../mentoring/discord";
import type { Messages } from "../i18n";
import { pt } from "../i18n/pt";
import { categoryIndex, categoryRange } from "./naming";

const MEMBER_ALLOW = {
  ViewChannel: true,
  SendMessages: true,
  ReadMessageHistory: true,
  AttachFiles: true,
  EmbedLinks: true,
  AddReactions: true,
  Connect: true,
  Speak: true,
  Stream: true,
  UseVAD: true,
} as const;

const STAFF_ALLOW = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks, P.Connect, P.Speak, P.Stream, P.UseVAD];
const BOT_ALLOW = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.ManageChannels, P.ManageRoles, P.ManageMessages, P.Connect];

export function teamTopic(team: TeamRow, desafioNome?: string | null, t: Messages = pt): string {
  return t.team.topic(t.teamLabel(team.number), team.sheet_label, desafioNome ?? team.desafio);
}

/** Cria/atualiza categorias e canais privados das equipes no Discord. */
export class DiscordTeamGateway implements TeamGateway {
  constructor(
    private readonly guild: Guild,
    private readonly repo: Repo,
    private readonly roles: { mentor: Role; organizacao: Role },
    private readonly perCategory: number,
    /** id do desafio → nome, para o tópico do canal. */
    private readonly desafioNome: (id: string | null) => string | null = () => null,
    private readonly t: Messages = pt,
  ) {}

  private baseOverwrites(): OverwriteResolvable[] {
    return [
      { id: this.guild.roles.everyone.id, deny: [P.ViewChannel] },
      { id: this.roles.mentor.id, allow: STAFF_ALLOW },
      { id: this.roles.organizacao.id, allow: [...STAFF_ALLOW, P.ManageMessages] },
      { id: this.guild.members.me!.id, allow: BOT_ALLOW },
    ];
  }

  private async getChannel<T extends GuildChannel>(id: string | null): Promise<T | null> {
    if (!id) return null;
    const cached = this.guild.channels.cache.get(id);
    if (cached) return cached as unknown as T;
    try {
      return (await this.guild.channels.fetch(id)) as unknown as T | null;
    } catch {
      return null; // apagado manualmente
    }
  }

  /** Categoria de texto (ou de voz) que abriga a equipe; cada uma tem no máximo `perCategory` canais. */
  private async ensureCategory(teamNumber: number, voice: boolean): Promise<CategoryChannel> {
    const idx = categoryIndex(teamNumber, this.perCategory);
    const saved = this.repo.category(idx) ?? { idx, text_category_id: null, voice_category_id: null };
    const savedId = voice ? saved.voice_category_id : saved.text_category_id;
    let cat = await this.getChannel<CategoryChannel>(savedId);

    if (!cat) {
      const { start, end } = categoryRange(idx, this.perCategory);
      const name = this.t.categoryName(start, end, voice);
      cat =
        (this.guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildCategory && looseName(c.name) === looseName(name),
        ) as CategoryChannel | undefined) ??
        (await this.guild.channels.create({
          name,
          type: ChannelType.GuildCategory,
          permissionOverwrites: this.baseOverwrites(),
          reason: "Categoria de equipes do hackathon",
        }));
      this.repo.saveCategory({
        ...saved,
        [voice ? "voice_category_id" : "text_category_id"]: cat.id,
      });
      logger.info({ category: cat.name }, "categoria de equipes pronta");
    }
    return cat;
  }

  async ensureTeamChannels(team: TeamRow): Promise<TeamRow> {
    const name = this.t.teamName(team.number);
    let text = await this.getChannel<TextChannel>(team.text_channel_id);
    let voice = await this.getChannel<VoiceChannel>(team.voice_channel_id);
    let createdText = false;

    if (!text) {
      text = await this.guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: await this.ensureCategory(team.number, false),
        topic: teamTopic(team, this.desafioNome(team.desafio), this.t),
        permissionOverwrites: this.baseOverwrites(),
        reason: `Canal da ${name}`,
      });
      createdText = true;
    }
    if (!voice) {
      voice = await this.guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: await this.ensureCategory(team.number, true),
        permissionOverwrites: this.baseOverwrites(),
        reason: `Voz da ${name}`,
      });
    }
    if (text.id !== team.text_channel_id || voice.id !== team.voice_channel_id) {
      this.repo.setTeamChannels(team.number, text.id, voice.id);
    }
    if (createdText) await this.sendWelcome(text, team);
    return this.repo.team(team.number)!;
  }

  private async sendWelcome(channel: TextChannel, team: TeamRow) {
    const embed = new EmbedBuilder()
      .setTitle(this.t.team.welcomeTitle(this.t.teamName(team.number)))
      .setColor(0x2b8a3e)
      .setDescription(this.t.team.welcomeBody(team.sheet_label));
    const msg = await channel.send({ embeds: [embed], components: [mentoriaButtonRow(this.t)] });
    await msg.pin().catch(() => undefined);
  }

  async grantAccess(team: TeamRow, discordId: string): Promise<void> {
    const text = await this.getChannel<TextChannel>(team.text_channel_id);
    const voice = await this.getChannel<VoiceChannel>(team.voice_channel_id);
    const isNew = text ? !text.permissionOverwrites.cache.has(discordId) : false;
    await Promise.all([
      text?.permissionOverwrites.edit(discordId, MEMBER_ALLOW, { reason: "Membro da equipe" }),
      voice?.permissionOverwrites.edit(discordId, MEMBER_ALLOW, { reason: "Membro da equipe" }),
    ]);
    if (text && isNew) {
      await text.send({ content: this.t.team.joined(discordId), allowedMentions: { users: [discordId] } });
    }
  }

  async revokeAccess(team: TeamRow, discordId: string): Promise<void> {
    const text = await this.getChannel<TextChannel>(team.text_channel_id);
    const voice = await this.getChannel<VoiceChannel>(team.voice_channel_id);
    await Promise.all([
      text?.permissionOverwrites.delete(discordId, "Saiu da equipe"),
      voice?.permissionOverwrites.delete(discordId, "Saiu da equipe"),
    ]);
  }

  /** Atualiza o tópico do canal de texto (ex.: após escolher desafio). */
  async refreshTopic(team: TeamRow): Promise<void> {
    const text = await this.getChannel<TextChannel>(team.text_channel_id);
    // O Discord limita edições de nome/tópico a 2 a cada 10 min por canal; o discord.js enfileira.
    await text?.setTopic(teamTopic(team, this.desafioNome(team.desafio), this.t));
  }
}
