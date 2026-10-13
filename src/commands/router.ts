import { type Message, MessageType } from "discord.js";
import { isMentor, isOrganizacao, type BotContext } from "../bot/context";
import { describeDiscordError, sendTemp } from "../bot/messaging";
import { logger } from "../logger";
import { entrar } from "./entrar";

export const PREFIX = "!";

export interface Command {
  /** Só cargo Organização (ou administradores). */
  staffOnly?: boolean;
  /** Com staffOnly: libera também para o cargo Mentor. */
  allowMentors?: boolean;
  run(ctx: BotContext, msg: Message<true>, args: string[], rest: string): Promise<void>;
}

/** Registro de comandos. Aliases sem acento/hífen apontam para o mesmo comando. */
const entrarCmd: Command = { run: (ctx, msg, _a, rest) => entrar(ctx, msg, rest) };
export const commands = new Map<string, Command>([
  ["entrar", entrarCmd],
  ["join", entrarCmd],
  ["checkin", entrarCmd],
]);

/** Comandos que participantes também podem usar no #check-in (além do !entrar). */
const CHECKIN_ALLOWED = new Set(["help", "ajuda", "comandos", "commands"]);

export function registerCommand(names: string[], cmd: Command) {
  for (const n of names) commands.set(n, cmd);
}

/** "!Forçar-Entrada x y" → { name: "forcar-entrada", rest: "x y" } */
export function parseCommand(content: string): { name: string; args: string[]; rest: string } | null {
  if (!content.startsWith(PREFIX)) return null;
  const body = content.slice(PREFIX.length);
  const m = body.match(/^(\S+)\s*([\s\S]*)$/);
  if (!m) return null;
  const name = m[1]!
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const rest = m[2]!.trim();
  return { name, args: rest ? rest.split(/\s+/) : [], rest };
}

export async function handleMessage(ctx: BotContext, msg: Message): Promise<void> {
  if (!msg.inGuild() || msg.guildId !== ctx.guild.id) return;

  // Aviso automático "Fulano entrou no servidor": apaga após alguns segundos, sem resposta.
  if (msg.type === MessageType.UserJoin) {
    const seconds = ctx.env.APAGAR_AVISO_ENTRADA_SEGUNDOS;
    if (seconds > 0) {
      setTimeout(() => {
        void msg.delete().catch((err) => logger.warn({ err: describeDiscordError(err) }, "não apaguei aviso de entrada"));
      }, seconds * 1000);
    }
    return;
  }
  const parsed = parseCommand(msg.content);

  // #check-in: só ficam as mensagens do próprio bot. Qualquer outra (participante, staff ou outro bot)
  // é apagada. O check-in é feito pelo botão; !entrar e !help ainda funcionam para quem conseguir escrever.
  if (msg.channelId === ctx.channels.checkin.id && msg.author.id !== ctx.client.user.id) {
    const cmd = parsed ? commands.get(parsed.name) : undefined;
    const usable = !msg.author.bot && parsed && (cmd === entrarCmd || CHECKIN_ALLOWED.has(parsed.name));
    if (!usable) {
      await msg.delete().catch(() => undefined);
      if (!msg.author.bot) {
        await sendTemp(msg.channel, `<@${msg.author.id}> ${ctx.t.checkin.onlyCommandHere(ctx.channels.chat?.id ?? null)}`, {
          mention: msg.author.id,
          seconds: 15,
        });
      }
      return;
    }
  }
  if (msg.author.bot) return;
  if (!parsed) return;

  const cmd = commands.get(parsed.name);
  if (!cmd) return;
  const allowed = isOrganizacao(ctx, msg.member) || (cmd.allowMentors && isMentor(ctx, msg.member));
  if (cmd.staffOnly && !allowed) {
    await sendTemp(msg.channel, `<@${msg.author.id}> ${cmd.allowMentors ? ctx.t.mentorsAndStaffOnly : ctx.t.staffOnly}`, {
      mention: msg.author.id,
    });
    return;
  }

  try {
    await cmd.run(ctx, msg, parsed.args, parsed.rest);
  } catch (err) {
    // Não loga o conteúdo da mensagem (pode ter e-mail).
    logger.error({ command: parsed.name, user: msg.author.id, err: describeDiscordError(err) }, "erro no comando");
    await sendTemp(msg.channel, `<@${msg.author.id}> ${ctx.t.somethingWrong}`, { mention: msg.author.id });
    await ctx.audit(`❗ Erro no comando \`!${parsed.name}\` de <@${msg.author.id}>: ${describeDiscordError(err)}`);
  }
}
