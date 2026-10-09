import { readFileSync } from "node:fs";
import { MessageType } from "discord.js";
import type { BotContext } from "../bot/context";
import { describeDiscordError } from "../bot/messaging";
import { logger } from "../logger";
import { CHECKIN_BUTTON_ID, checkinButtonRow } from "./checkinButton";

const META_KEY = "checkin_instructions_message_id";

/**
 * Garante a mensagem fixada de instruções no #check-in (idempotente):
 * cria na primeira vez, edita se o texto do arquivo mudou (ou falta o botão) e recria se foi apagada.
 */
export async function ensureCheckinInstructions(ctx: BotContext, path: string): Promise<void> {
  const content = readFileSync(path, "utf8").trim();
  const channel = ctx.channels.checkin;
  try {
    const savedId = ctx.repo.getMeta(META_KEY);
    const existing = savedId ? await channel.messages.fetch(savedId).catch(() => null) : null;

    if (existing) {
      const hasButton = existing.components.some((row) => JSON.stringify(row.toJSON()).includes(CHECKIN_BUTTON_ID));
      if (existing.content !== content || !hasButton) {
        await existing.edit({ content, components: [checkinButtonRow(ctx.t)], allowedMentions: { parse: [] } });
        logger.info("mensagem de check-in atualizada");
      }
      if (!existing.pinned) await existing.pin().catch(() => undefined);
      return;
    }

    const msg = await channel.send({ content, components: [checkinButtonRow(ctx.t)], allowedMentions: { parse: [] } });
    ctx.repo.setMeta(META_KEY, msg.id);
    await msg.pin("Instruções de check-in");
    // Remove o aviso "fixou uma mensagem" para o canal ficar limpo.
    const recent = await channel.messages.fetch({ limit: 5 });
    for (const m of recent.values()) {
      if (m.type === MessageType.ChannelPinnedMessage && m.reference?.messageId === msg.id) await m.delete().catch(() => undefined);
    }
    logger.info("mensagem de check-in publicada");
  } catch (err) {
    await ctx.audit(`❗ Não consegui publicar as instruções no <#${channel.id}>: ${describeDiscordError(err)}`);
  }
}
