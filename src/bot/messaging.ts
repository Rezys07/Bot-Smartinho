import { DiscordAPIError, type GuildTextBasedChannel, type TextChannel } from "discord.js";
import { logger } from "../logger";

/** Códigos de erro do Discord mais comuns, para mensagens legíveis. */
export function describeDiscordError(err: unknown): string {
  if (err instanceof DiscordAPIError) {
    if (err.code === 50013) return "permissão faltando para o bot (Missing Permissions)";
    if (err.code === 50001) return "o bot não tem acesso ao canal (Missing Access)";
    if (err.code === 10008) return "mensagem já apagada";
    return `erro do Discord ${err.code}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Envia uma mensagem que se apaga sozinha. Menciona só o usuário indicado. */
export async function sendTemp(
  channel: GuildTextBasedChannel,
  content: string,
  opts: { mention?: string; seconds?: number } = {},
): Promise<void> {
  try {
    const msg = await channel.send({
      content,
      allowedMentions: { users: opts.mention ? [opts.mention] : [], roles: [], parse: [] },
    });
    setTimeout(() => void msg.delete().catch(() => undefined), (opts.seconds ?? 20) * 1000);
  } catch (err) {
    logger.warn({ channel: channel.id, err: describeDiscordError(err) }, "falha ao enviar mensagem temporária");
  }
}

/** Registro para a organização em #bot-logs. Nunca inclua e-mail ou telefone aqui. */
export function makeAudit(channel: TextChannel | null) {
  return async (text: string): Promise<void> => {
    logger.info({ audit: text }, "audit");
    if (!channel) return;
    try {
      await channel.send({ content: text.slice(0, 2000), allowedMentions: { parse: [] } });
    } catch (err) {
      logger.error({ err: describeDiscordError(err) }, "falha ao escrever em #bot-logs");
    }
  };
}

export type Audit = ReturnType<typeof makeAudit>;
