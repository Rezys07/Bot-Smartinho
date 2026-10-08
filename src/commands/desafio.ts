import { EmbedBuilder, type Message } from "discord.js";
import { isOrganizacao, type BotContext } from "../bot/context";
import { describeDiscordError, sendTemp } from "../bot/messaging";
import { canSetDesafio, formatDeadline, resolveDesafio } from "../teams/desafios";
import { teamName } from "../teams/naming";
import { registerCommand } from "./router";

function listEmbed(ctx: BotContext, currentId: string | null) {
  const prazo = ctx.env.DESAFIO_PRAZO;
  return new EmbedBuilder()
    .setTitle("Desafios")
    .setColor(0x1971c2)
    .setDescription(
      ctx.desafios
        .map((d) => `${d.id === currentId ? "✅" : "▫️"} **${d.id}. ${d.nome}**${d.descricao ? `\n${d.descricao}` : ""}`)
        .join("\n\n"),
    )
    .setFooter({
      text:
        "Escolha com !desafio <número>." +
        (prazo ? ` Trocas permitidas até ${formatDeadline(prazo)}.` : ""),
    });
}

/** `!desafio` lista; `!desafio <opção>` escolhe. Só no canal de texto da equipe. */
async function desafio(ctx: BotContext, msg: Message<true>, rest: string) {
  const team = ctx.repo.teamByChannel(msg.channelId);
  const staff = isOrganizacao(ctx, msg.member);
  if (!team || team.text_channel_id !== msg.channelId) {
    await sendTemp(msg.channel, `<@${msg.author.id}> use \`!desafio\` no canal de texto da sua equipe.`, { mention: msg.author.id });
    return;
  }
  const participant = ctx.repo.participant(msg.author.id);
  if (!staff && participant?.team_number !== team.number) {
    await sendTemp(msg.channel, `<@${msg.author.id}> só membros da equipe podem escolher o desafio.`, { mention: msg.author.id });
    return;
  }

  if (!rest) {
    await msg.reply({ embeds: [listEmbed(ctx, team.desafio)], allowedMentions: { repliedUser: false } });
    return;
  }

  const chosen = resolveDesafio(ctx.desafios, rest);
  if (!chosen) {
    await msg.reply({
      content: "Não reconheci essa opção. Veja a lista:",
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
    await msg.reply({ content: `A equipe já está no desafio **${chosen.nome}**.`, allowedMentions: { repliedUser: false } });
    return;
  }
  if (decision === "deadline_passed") {
    await msg.reply({
      content: `O prazo para trocar de desafio terminou em ${formatDeadline(ctx.env.DESAFIO_PRAZO!)}. Fale com a organização se precisar.`,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const previous = team.desafio ? ctx.desafios.find((d) => d.id === team.desafio)?.nome ?? team.desafio : null;
  ctx.repo.setDesafio(team.number, chosen.id);
  await msg.reply({
    content: previous
      ? `🔄 Desafio alterado de **${previous}** para **${chosen.nome}**.`
      : `🎯 Desafio escolhido: **${chosen.nome}**. Bom trabalho!`,
    allowedMentions: { repliedUser: false },
  });
  await ctx.audit(
    `🎯 **${teamName(team.number)}**: desafio ${previous ? `alterado de "${previous}" para` : "escolhido:"} "${chosen.nome}" por <@${msg.author.id}>.`,
  );
  // Não bloqueia a resposta: o Discord pode segurar a edição do tópico por alguns minutos.
  void ctx.gateway.refreshTopic(ctx.repo.team(team.number)!).catch((err) =>
    ctx.audit(`❗ Não consegui atualizar o tópico de ${teamName(team.number)}: ${describeDiscordError(err)}`),
  );
}

registerCommand(["desafio", "desafios"], { run: (ctx, msg, _args, rest) => desafio(ctx, msg, rest) });
