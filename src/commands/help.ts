import { EmbedBuilder, type Message } from "discord.js";
import { isMentor, isOrganizacao, type BotContext } from "../bot/context";
import { sendTemp } from "../bot/messaging";
import { registerCommand } from "./router";

/** Monta a ajuda conforme o cargo de quem pediu (organização vê tudo). */
export function helpText(ctx: BotContext, opts: { mentor: boolean; organizacao: boolean }): string {
  const h = ctx.t.help;
  const parts = [h.checkin(ctx.channels.checkin.id), h.team];
  if (opts.mentor || opts.organizacao) parts.push(h.mentor(ctx.channels.filaMentoria?.id ?? null));
  if (opts.organizacao) parts.push(h.admin);
  parts.push(h.other);
  return parts.join("\n\n");
}

async function help(ctx: BotContext, msg: Message<true>) {
  const embed = new EmbedBuilder()
    .setTitle(ctx.t.help.title)
    .setColor(0x1971c2)
    .setDescription(helpText(ctx, { mentor: isMentor(ctx, msg.member), organizacao: isOrganizacao(ctx, msg.member) }));

  // No #check-in a mensagem do participante é apagada e a ajuda some depois de um tempo, para o canal ficar limpo.
  if (msg.channelId === ctx.channels.checkin.id) {
    await msg.delete().catch(() => undefined);
    const sent = await msg.channel.send({ content: `<@${msg.author.id}>`, embeds: [embed], allowedMentions: { users: [msg.author.id] } });
    setTimeout(() => void sent.delete().catch(() => undefined), 60_000);
    return;
  }
  await msg.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() =>
    sendTemp(msg.channel, ctx.t.somethingWrong),
  );
}

registerCommand(["help", "ajuda", "comandos", "commands"], { run: (ctx, msg) => help(ctx, msg) });
