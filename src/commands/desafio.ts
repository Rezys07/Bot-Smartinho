import { EmbedBuilder, type Message } from "discord.js";
import { isOrganizacao, type BotContext } from "../bot/context";
import { describeDiscordError, sendTemp } from "../bot/messaging";
import { canSetDesafio, formatDeadline, resolveDesafio } from "../teams/desafios";
import { registerCommand } from "./router";

function listEmbed(ctx: BotContext, currentId: string | null) {
  const prazo = ctx.env.DESAFIO_PRAZO;
  return new EmbedBuilder()
    .setTitle(ctx.t.desafio.title)
    .setColor(0x1971c2)
    .setDescription(
      ctx.desafios
        .map((d) => `${d.id === currentId ? "✅" : "▫️"} **${d.id}. ${d.nome}**${d.descricao ? `\n${d.descricao}` : ""}`)
        .join("\n\n"),
    )
    .setFooter({
      text: ctx.t.desafio.footer(prazo ? formatDeadline(prazo, ctx.t.locale) : null),
    });
}

/** `!desafio` lista; `!desafio <opção>` escolhe. Só no canal de texto da equipe. */
async function desafio(ctx: BotContext, msg: Message<true>, rest: string) {
  const team = ctx.repo.teamByChannel(msg.channelId);
  const staff = isOrganizacao(ctx, msg.member);
  if (!team || team.text_channel_id !== msg.channelId) {
    await sendTemp(msg.channel, `<@${msg.author.id}> ${ctx.t.desafio.useTeamChannel}`, { mention: msg.author.id });
    return;
  }
  const participant = ctx.repo.participant(msg.author.id);
  if (!staff && participant?.team_number !== team.number) {
    await sendTemp(msg.channel, `<@${msg.author.id}> ${ctx.t.desafio.membersOnly}`, { mention: msg.author.id });
    return;
  }

  if (!rest) {
    await msg.reply({ embeds: [listEmbed(ctx, team.desafio)], allowedMentions: { repliedUser: false } });
    return;
  }

  const chosen = resolveDesafio(ctx.desafios, rest);
  if (!chosen) {
    await msg.reply({
      content: ctx.t.desafio.unknown,
      embeds: [listEmbed(ctx, team.desafio)],
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const decision = canSetDesafio({
    current: team.desafio,
    next: chosen.id,
    deadline: ctx.env.DESAFIO_PRAZO,
    now: new Date(),
    isOrganizacao: staff,
  });
  if (decision === "same") {
    await msg.reply({ content: ctx.t.desafio.same(chosen.nome), allowedMentions: { repliedUser: false } });
    return;
  }
  if (decision === "deadline_passed") {
    await msg.reply({
      content: ctx.t.desafio.deadlinePassed(formatDeadline(ctx.env.DESAFIO_PRAZO!, ctx.t.locale)),
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const previous = team.desafio ? ctx.desafios.find((d) => d.id === team.desafio)?.nome ?? team.desafio : null;
  ctx.repo.setDesafio(team.number, chosen.id);
  await msg.reply({
    content: previous ? ctx.t.desafio.changed(previous, chosen.nome) : ctx.t.desafio.chosen(chosen.nome),
    allowedMentions: { repliedUser: false },
  });
  await ctx.audit(
    `🎯 **${ctx.t.teamName(team.number)}**: desafio ${previous ? `alterado de "${previous}" para` : "escolhido:"} "${chosen.nome}" por <@${msg.author.id}>.`,
  );
  // Não bloqueia a resposta: o Discord pode segurar a edição do tópico por alguns minutos.
  void ctx.gateway.refreshTopic(ctx.repo.team(team.number)!).catch((err) =>
    ctx.audit(`❗ Não consegui atualizar o tópico de ${ctx.t.teamName(team.number)}: ${describeDiscordError(err)}`),
  );
}

registerCommand(["desafio", "desafios", "challenge", "challenges"], { run: (ctx, msg, _args, rest) => desafio(ctx, msg, rest) });
