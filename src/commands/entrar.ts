import type { GuildMember, Message } from "discord.js";
import { type BotContext } from "../bot/context";
import { describeDiscordError, sendTemp } from "../bot/messaging";
import { logger } from "../logger";
import type { ParticipantRow, TeamRow } from "../db/repo";
import { buildNickname, teamName } from "../teams/naming";

/** Aplica cargo e apelido. Falhas (ex.: hierarquia de cargos) são registradas, não interrompem. */
export async function applyParticipantIdentity(
  ctx: BotContext,
  member: GuildMember,
  participant: ParticipantRow,
  team: TeamRow | null,
): Promise<string[]> {
  const problems: string[] = [];
  if (!member.roles.cache.has(ctx.roles.participante.id)) {
    await member.roles.add(ctx.roles.participante, "Check-in no hackathon").catch((err) => {
      problems.push(`cargo ${ctx.roles.participante.name}: ${describeDiscordError(err)}`);
    });
  }
  const nick = buildNickname(participant.display_name, team?.number ?? null);
  if (member.nickname !== nick && member.id !== ctx.guild.ownerId) {
    await member.setNickname(nick, "Check-in no hackathon").catch((err) => {
      problems.push(`apelido: ${describeDiscordError(err)}`);
    });
  }
  return problems;
}

/** `!entrar email@exemplo.com` — só em #check-in. A mensagem é apagada antes de qualquer coisa. */
export async function entrar(ctx: BotContext, msg: Message<true>, rest: string): Promise<void> {
  const user = msg.author.id;
  await msg.delete().catch((err) => {
    void ctx.audit(`❗ Não consegui apagar um \`!entrar\` de <@${user}> em <#${msg.channelId}>: ${describeDiscordError(err)}. Apague manualmente.`);
  });

  if (msg.channelId !== ctx.channels.checkin.id) {
    await sendTemp(msg.channel, `<@${user}> use o comando no canal <#${ctx.channels.checkin.id}>.`, { mention: user });
    return;
  }
  if (!rest.trim()) {
    await sendTemp(msg.channel, `<@${user}> use: \`!entrar seu-email@exemplo.com\` (o mesmo e-mail da inscrição).`, { mention: user });
    return;
  }

  const r = await ctx.checkin.checkIn(user, rest.trim().split(/\s+/)[0]!);
  const reply = (text: string, seconds = 25) => sendTemp(msg.channel, `<@${user}> ${text}`, { mention: user, seconds });

  switch (r.kind) {
    case "invalid_email":
      await reply(`isso não parece um e-mail. Use: \`!entrar seu-email@exemplo.com\`. Tentativas restantes: ${r.attemptsLeft}.`);
      if (r.attemptsLeft === 0) await ctx.audit(`🚫 <@${user}> atingiu o limite de tentativas de check-in.`);
      return;
    case "not_found":
      await reply(
        "não encontrei esse e-mail na lista de inscritos. Confira se é exatamente o e-mail usado na inscrição. " +
          `Se o problema continuar, fale com a organização. Tentativas restantes: ${r.attemptsLeft}.`,
        40,
      );
      if (r.attemptsLeft === 0) await ctx.audit(`🚫 <@${user}> atingiu o limite de tentativas de check-in (e-mail não encontrado).`);
      return;
    case "rate_limited":
      await reply(`muitas tentativas. Tente de novo em ${r.retryAfterMin} min ou procure a organização.`);
      return;
    case "sheet_unavailable":
      await reply("a lista de inscritos está indisponível agora. Tente de novo em alguns minutos.");
      await ctx.audit("❗ Check-in recusado: planilha ainda não carregada (verifique credenciais/rede e use `!sync`).");
      return;
    case "email_taken":
      await reply("esse e-mail já foi usado por outra conta do Discord. A organização foi avisada e vai falar com você.", 40);
      await ctx.audit(
        `⚠️ <@${user}> tentou fazer check-in com um e-mail já usado por <@${r.otherDiscordId}>. ` +
          "Se for a mesma pessoa com outra conta, use `!remover` na conta antiga e `!forcar-entrada` na nova.",
      );
      return;
    case "already":
    case "ok": {
      const member = msg.member ?? (await ctx.guild.members.fetch(user));
      const problems = await applyParticipantIdentity(ctx, member, r.participant, r.team);
      if (r.provisionError) problems.push(`canais da equipe: ${r.provisionError}`);

      const where = r.team?.text_channel_id ? ` → <#${r.team.text_channel_id}>` : "";
      const teamText = r.team ? `**${teamName(r.team.number)}**${where}` : "nenhuma equipe ainda (fale com a organização)";
      await reply(r.kind === "ok" ? `✅ check-in confirmado! Sua equipe: ${teamText}` : `você já fez check-in. Sua equipe: ${teamText}`);

      if (r.kind === "ok") {
        await ctx.audit(
          `✅ Check-in: <@${user}> (${r.participant.display_name}) → **${teamName(r.team.number)}**` +
            (r.createdTeam ? " (equipe criada)" : ""),
        );
      }
      if (problems.length) {
        logger.warn({ user, problems }, "check-in com problemas");
        await ctx.audit(`❗ Check-in de <@${user}> com problemas: ${problems.join("; ")}`);
      }
      return;
    }
  }
}
