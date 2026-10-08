import { EmbedBuilder, type GuildMember, type Message } from "discord.js";
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

/** Comprovante por mensagem direta. Se a pessoa bloqueia DMs, ignora (ela já viu a resposta). */
async function sendReceipt(member: GuildMember, team: TeamRow) {
  const embed = new EmbedBuilder()
    .setTitle("✅ Check-in confirmado — Hackathon Cidades Inteligentes")
    .setColor(0x2b8a3e)
    .setDescription(
      [
        `Sua equipe: **${teamName(team.number)}**${team.sheet_label ? ` (${team.sheet_label})` : ""}`,
        team.text_channel_id ? `Canal da equipe: <#${team.text_channel_id}>` : null,
        "",
        "**Comandos** (no canal da equipe)",
        "`!desafio` — ver e escolher o desafio",
        "`!queromentoria <o que vocês precisam>` — pedir ajuda a um mentor",
        "",
        "Boa sorte e bom Hackathon! 💡🏆",
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

/**
 * Faz o check-in e todos os efeitos (cargo, apelido, DM, #bot-logs).
 * Retorna o texto de resposta para a pessoa — quem chama decide como exibir.
 */
export async function runCheckin(ctx: BotContext, userId: string, email: string, how: "botão" | "!entrar"): Promise<CheckinReply> {
  const r = await ctx.checkin.checkIn(userId, email);

  switch (r.kind) {
    case "invalid_email":
      if (r.attemptsLeft === 0) await ctx.audit(`🚫 <@${userId}> atingiu o limite de tentativas de check-in.`);
      return { ok: false, text: `Isso não parece um e-mail. Confira e tente de novo. Tentativas restantes: ${r.attemptsLeft}.` };
    case "not_found":
      if (r.attemptsLeft === 0) await ctx.audit(`🚫 <@${userId}> atingiu o limite de tentativas de check-in (e-mail não encontrado).`);
      return {
        ok: false,
        text:
          "Não encontrei esse e-mail na lista de inscritos. Confira se é exatamente o e-mail usado na inscrição. " +
          `Se o problema continuar, fale com a organização. Tentativas restantes: ${r.attemptsLeft}.`,
      };
    case "rate_limited":
      return { ok: false, text: `Muitas tentativas. Tente de novo em ${r.retryAfterMin} min ou procure a organização.` };
    case "sheet_unavailable":
      await ctx.audit("❗ Check-in recusado: planilha ainda não carregada (verifique credenciais/rede e use `!sync`).");
      return { ok: false, text: "A lista de inscritos está indisponível agora. Tente de novo em alguns minutos." };
    case "email_taken":
      await ctx.audit(
        `⚠️ <@${userId}> tentou fazer check-in com um e-mail já usado por <@${r.otherDiscordId}>. ` +
          "Se for a mesma pessoa com outra conta, use `!remover` na conta antiga e `!forcar-entrada` na nova.",
      );
      return { ok: false, text: "Esse e-mail já foi usado por outra conta do Discord. A organização foi avisada e vai falar com você." };
    case "already":
    case "ok": {
      const member = await ctx.guild.members.fetch(userId);
      const problems = await applyParticipantIdentity(ctx, member, r.participant, r.team);
      if (r.provisionError) problems.push(`canais da equipe: ${r.provisionError}`);

      const where = r.team?.text_channel_id ? ` → <#${r.team.text_channel_id}>` : "";
      const teamText = r.team ? `**${teamName(r.team.number)}**${where}` : "nenhuma equipe ainda (fale com a organização)";

      if (r.kind === "ok") {
        await ctx.audit(
          `✅ Check-in (${how}): <@${userId}> (${r.participant.display_name}) → **${teamName(r.team.number)}**` +
            (r.createdTeam ? " (equipe criada)" : ""),
        );
        await sendReceipt(member, r.team);
      }
      if (problems.length) {
        logger.warn({ user: userId, problems }, "check-in com problemas");
        await ctx.audit(`❗ Check-in de <@${userId}> com problemas: ${problems.join("; ")}`);
      }
      return {
        ok: true,
        text: r.kind === "ok" ? `✅ Check-in confirmado! Sua equipe: ${teamText}` : `Você já fez check-in. Sua equipe: ${teamText}`,
      };
    }
  }
}

/** `!entrar email@exemplo.com` — alternativa ao botão. A mensagem é apagada antes de qualquer coisa. */
export async function entrar(ctx: BotContext, msg: Message<true>, rest: string): Promise<void> {
  const user = msg.author.id;
  await msg.delete().catch((err) => {
    void ctx.audit(`❗ Não consegui apagar um \`!entrar\` de <@${user}> em <#${msg.channelId}>: ${describeDiscordError(err)}. Apague manualmente.`);
  });

  if (msg.channelId !== ctx.channels.checkin.id) {
    await sendTemp(msg.channel, `<@${user}> faça o check-in no canal <#${ctx.channels.checkin.id}>.`, { mention: user });
    return;
  }
  if (!rest.trim()) {
    await sendTemp(msg.channel, `<@${user}> clique no botão **✅ Fazer check-in** da mensagem fixada, ou use \`!entrar seu-email@exemplo.com\`.`, {
      mention: user,
    });
    return;
  }

  const r = await runCheckin(ctx, user, rest.trim().split(/\s+/)[0]!, "!entrar");
  await sendTemp(msg.channel, `<@${user}> ${r.text}`, { mention: user, seconds: r.ok ? 25 : 40 });
}
