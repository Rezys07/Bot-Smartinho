import {
  type ButtonInteraction,
  type Interaction,
  MessageFlags,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { BotContext } from "../bot/context";
import { describeDiscordError } from "../bot/messaging";
import { logger } from "../logger";

type ButtonHandler = (ctx: BotContext, i: ButtonInteraction<"cached">, arg: string) => Promise<void>;
type ModalHandler = (ctx: BotContext, i: ModalSubmitInteraction<"cached">, arg: string) => Promise<void>;
type SelectHandler = (ctx: BotContext, i: StringSelectMenuInteraction<"cached">, arg: string) => Promise<void>;

/** customId no formato "<prefixo>:<ação>[:<argumento>]", ex.: "checkin:abrir", "mentoria:atender:12". */
const buttons = new Map<string, ButtonHandler>();
const modals = new Map<string, ModalHandler>();
const selects = new Map<string, SelectHandler>();

export function registerButton(key: string, handler: ButtonHandler) {
  buttons.set(key, handler);
}

export function registerModal(key: string, handler: ModalHandler) {
  modals.set(key, handler);
}

export function registerSelect(key: string, handler: SelectHandler) {
  selects.set(key, handler);
}

/** "mentoria:atender:12" → { key: "mentoria:atender", arg: "12" } */
export function splitCustomId(customId: string): { key: string; arg: string } {
  const [prefix = "", action = "", ...rest] = customId.split(":");
  return { key: `${prefix}:${action}`, arg: rest.join(":") };
}

export async function handleInteraction(ctx: BotContext, i: Interaction): Promise<void> {
  if (!i.inCachedGuild() || i.guildId !== ctx.guild.id) return;
  if (!i.isButton() && !i.isModalSubmit() && !i.isStringSelectMenu()) return;

  const { key, arg } = splitCustomId(i.customId);
  try {
    if (i.isButton()) await buttons.get(key)?.(ctx, i, arg);
    else if (i.isStringSelectMenu()) await selects.get(key)?.(ctx, i, arg);
    else await modals.get(key)?.(ctx, i, arg);
  } catch (err) {
    logger.error({ customId: i.customId, user: i.user.id, err: describeDiscordError(err) }, "erro na interação");
    await ctx.audit(`❗ Erro na interação \`${key}\` de <@${i.user.id}>: ${describeDiscordError(err)}`);
    const content = "Algo deu errado. A organização foi avisada.";
    if (i.deferred || i.replied) await i.editReply({ content }).catch(() => undefined);
    else await i.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}
