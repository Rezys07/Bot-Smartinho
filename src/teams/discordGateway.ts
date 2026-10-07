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
import { categoryIndex, categoryName, teamName } from "./naming";

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

export function teamTopic(team: TeamRow): string {
  const parts = [`Equipe ${String(team.number).padStart(3, "0")}`];
  if (team.sheet_label) parts.push(`Nome na inscrição: ${team.sheet_label}`);
  parts.push(`Desafio: ${team.desafio ?? "não escolhido (use !desafio)"}`);
  return parts.join(" · ");
}

/** Cria/atualiza categorias e canais privados das equipes no Discord. */
export class DiscordTeamGateway implements TeamGateway {
  constructor(
    private readonly guild: Guild,
    private readonly repo: Repo,
    private readonly roles: { mentor: Role; organizacao: Role },
    private readonly perCategory: number,
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
      const name = categoryName(idx, this.perCategory, voice);
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
    const name = teamName(team.number);
    let text = await this.getChannel<TextChannel>(team.text_channel_id);
    let voice = await this.getChannel<VoiceChannel>(team.voice_channel_id);
    let createdText = false;

    if (!text) {
      text = await this.guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: await this.ensureCategory(team.number, false),
        topic: teamTopic(team),
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
      .setTitle(`Bem-vindos à ${teamName(team.number)}!`)
      .setColor(0x2b8a3e)
      .setDescription(
        [
          team.sheet_label ? `Equipe da inscrição: **${team.sheet_label}**` : null,
          "Este canal e o canal de voz com o mesmo nome são privados da equipe (mentores e organização também têm acesso).",
          "",
          "**Comandos**",
          "`!desafio` — lista os desafios; `!desafio <opção>` escolhe o da equipe",
          "`!queromentoria <o que vocês precisam>` — pede ajuda a um mentor",
          "`!queromentoria @mentor <descrição>` — pede um mentor específico",
        ]
          .filter((l) => l !== null)
          .join("\n"),
      );
    const msg = await channel.send({ embeds: [embed] });
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
      await text.send({ content: `👋 <@${discordId}> entrou na equipe!`, allowedMentions: { users: [discordId] } });
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
    await text?.setTopic(teamTopic(team));
  }
}
