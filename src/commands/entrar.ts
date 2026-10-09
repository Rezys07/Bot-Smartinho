import { EmbedBuilder, type GuildMember, type Message } from "discord.js";
import { isMentor, isOrganizacao, type BotContext } from "../bot/context";
import { describeDiscordError, sendTemp } from "../bot/messaging";
import { logger } from "../logger";
import type { ParticipantRow, TeamRow } from "../db/repo";
import type { CheckinResult } from "../teams/checkin";
import { buildNickname } from "../teams/naming";

/** Aplica cargo e apelido. Falhas (ex.: hierarquia de cargos) são registradas, não interrompem. */
export async function applyParticipantIdentity(
  ctx: BotContext,
  member: GuildMember,
  participant: ParticipantRow,
  team: TeamRow | null,
): Promise<string[]> {
  const problems: string[] = [];
  if (!member.roles.cache.has(ctx.roles.participante.id)) {
    await member.roles.add(ctx.roles.participante, "Check-in").catch((err) => {
      problems.push(`cargo ${ctx.roles.participante.name}: ${describeDiscordError(err)}`);
    });
  }
  const nick = buildNickname(participant.display_name, team?.number ?? null, ctx.t.defaultNickname);
  if (member.nickname !== nick && member.id !== ctx.guild.ownerId) {
    await member.setNickname(nick, "Check-in").catch((err) => {
      problems.push(`apelido: ${describeDiscordError(err)}`);
    });
  }
  return problems;
}

/** Comprovante por mensagem direta. Se a pessoa bloqueia DMs, ignora (ela já viu a resposta). */
async function sendReceipt(ctx: BotContext, member: GuildMember, team: TeamRow) {
  const c = ctx.t.checkin;
  const embed = new EmbedBuilder()
    .setTitle(c.receiptTitle)
    .setColor(0x2b8a3e)
    .setDescription(
      [
        c.receiptTeam(ctx.t.teamName(team.number), team.sheet_label),
        team.text_channel_id ? c.receiptChannel(team.text_channel_id) : null,
        "",
        ...c.receiptCommands,
        "",
        c.receiptBye,
      ]
        .filter((l) => l !== null)
        .join("\n"),
    );
  await member.send({ embeds: [embed] }).catch((err) => {
    logger.info({ user: member.id, err: describeDiscordError(err) }, "não foi possível enviar DM de check-in");
  });
}

export interface CheckinReply {
  text: string;
  ok: boolean;
}

export type CheckinMethod = "botão" | "botão (usuário)" | "!entrar" | "!entrar (usuário)";

/** Converte o resultado do check-in em resposta para a pessoa + efeitos (cargo, apelido, DM, #bot-logs). */
async function finishCheckin(ctx: BotContext, userId: string, r: CheckinResult, how: CheckinMethod): Promise<CheckinReply> {
  const c = ctx.t.checkin;
  switch (r.kind) {
    case "invalid_email":
      if (r.attemptsLeft === 0) await ctx.audit(`🚫 <@${userId}> atingiu o limite de tentativas de check-in.`);
      return { ok: false, text: c.invalidEmail(r.attemptsLeft) };
    case "not_found":
      if (r.attemptsLeft === 0) await ctx.audit(`🚫 <@${userId}> atingiu o limite de tentativas de check-in (e-mail não encontrado).`);
      return { ok: false, text: c.notFound(r.attemptsLeft) };
    case "username_not_found": {
      const member = await ctx.guild.members.fetch(userId).catch(() => null);
      await ctx.audit(`🔎 <@${userId}> tentou check-in pelo usuário do Discord, mas não está na planilha.`);
      return { ok: false, text: c.usernameNotFound(member?.user.username ?? "?") };
    }
    case "rate_limited":
      return { ok: false, text: c.rateLimited(r.retryAfterMin) };
    case "sheet_unavailable":
      await ctx.audit("❗ Check-in recusado: planilha ainda não carregada (verifique credenciais/rede e use `!sync`).");
      return { ok: false, text: c.sheetUnavailable };
    case "email_taken":
      await ctx.audit(
        `⚠️ <@${userId}> tentou fazer check-in com uma inscrição já usada por <@${r.otherDiscordId}>. ` +
          "Se for a mesma pessoa com outra conta, use `!remover` na conta antiga e `!forcar-entrada` na nova.",
      );
      return { ok: false, text: c.taken };
    case "already":
    case "ok": {
      const member = await ctx.guild.members.fetch(userId);
      const problems = await applyParticipantIdentity(ctx, member, r.participant, r.team);
      if (r.provisionError) problems.push(`canais da equipe: ${r.provisionError}`);

      const where = r.team?.text_channel_id ? ` → <#${r.team.text_channel_id}>` : "";
      const teamText = r.team ? `**${ctx.t.teamName(r.team.number)}**${where}` : c.noTeam;

      if (r.kind === "ok") {
        await ctx.audit(
          `✅ Check-in (${how}): <@${userId}> (${r.participant.display_name}) → **${ctx.t.teamName(r.team.number)}**` +
            (r.createdTeam ? " (equipe criada)" : ""),
        );
        await sendReceipt(ctx, member, r.team);
      }
      if (problems.length) {
        logger.warn({ user: userId, problems }, "check-in com problemas");
        await ctx.audit(`❗ Check-in de <@${userId}> com problemas: ${problems.join("; ")}`);
      }
      return { ok: true, text: r.kind === "ok" ? c.ok(teamText) : c.already(teamText) };
    }
  }
}

/** Staff não faz check-in: não ocupa vaga em equipe e já vê todos os canais pelo cargo. */
async function staffReply(ctx: BotContext, userId: string): Promise<CheckinReply | null> {
  if (ctx.repo.participant(userId)) return null; // já registrado antes: deixa seguir (idempotente)
  const member = await ctx.guild.members.fetch(userId).catch(() => null);
  if (member && (isMentor(ctx, member) || isOrganizacao(ctx, member))) return { ok: false, text: ctx.t.checkin.staffNoCheckin };
  return null;
}

/** Check-in por e-mail. */
export async function runCheckin(ctx: BotContext, userId: string, email: string, how: CheckinMethod): Promise<CheckinReply> {
  const staff = await staffReply(ctx, userId);
  if (staff) return staff;
  return finishCheckin(ctx, userId, await ctx.checkin.checkIn(userId, email), how);
}

/** Check-in pelo usuário do Discord (sem digitar nada). */
export async function runCheckinByUsername(ctx: BotContext, userId: string, username: string, how: CheckinMethod): Promise<CheckinReply> {
  const staff = await staffReply(ctx, userId);
  if (staff) return staff;
  return finishCheckin(ctx, userId, await ctx.checkin.checkInByUsername(userId, username), how);
}

/** A pessoa pode fazer check-in só pelo usuário? (já fez check-in, ou o usuário está na planilha) */
export function canCheckinByUsername(ctx: BotContext, userId: string, username: string): boolean {
  return !!ctx.repo.participant(userId) || !!ctx.store.findByUsername(username);
}

/** `!entrar [email]` / `!join [email]` — alternativa ao botão. A mensagem é apagada antes de qualquer coisa. */
export async function entrar(ctx: BotContext, msg: Message<true>, rest: string): Promise<void> {
  const user = msg.author.id;
  await msg.delete().catch((err) => {
    void ctx.audit(`❗ Não consegui apagar um \`!entrar\` de <@${user}> em <#${msg.channelId}>: ${describeDiscordError(err)}. Apague manualmente.`);
  });

  if (msg.channelId !== ctx.channels.checkin.id) {
    await sendTemp(msg.channel, `<@${user}> ${ctx.t.checkin.useChannel(ctx.channels.checkin.id)}`, { mention: user });
    return;
  }

  const email = rest.trim().split(/\s+/)[0] ?? "";
  let r: CheckinReply;
  if (email) r = await runCheckin(ctx, user, email, "!entrar");
  else if (canCheckinByUsername(ctx, user, msg.author.username) || ctx.store.snapshot?.sheet.hasEmailColumn === false) {
    r = await runCheckinByUsername(ctx, user, msg.author.username, "!entrar (usuário)");
  } else {
    await sendTemp(msg.channel, `<@${user}> ${ctx.t.checkin.usage}`, { mention: user });
    return;
  }
  await sendTemp(msg.channel, `<@${user}> ${r.text}`, { mention: user, seconds: r.ok ? 25 : 40 });
}
