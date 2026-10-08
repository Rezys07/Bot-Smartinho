import { ChannelType, type Guild, type Role, type TextChannel } from "discord.js";
import type { BotEnv } from "../config/env";

/** Nomes padrão (usados quando o ID não está no .env). */
export const RESOURCE_NAMES = {
  participante: "Convidado", // cargo dado no check-in
  mentor: "Mentor",
  organizacao: "Organização",
  checkin: "check-in",
  filaMentoria: "fila-mentoria",
  botLogs: "bot-logs",
} as const;

/** Compara ignorando acentos, caixa, emojis e separadores: "✅┃Check-in" ≈ "check-in". */
export const looseName = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export interface Resources {
  roles: { participante: Role; mentor: Role; organizacao: Role };
  channels: { checkin: TextChannel; filaMentoria: TextChannel | null; botLogs: TextChannel | null };
}

export function findRole(guild: Guild, id: string | undefined, name: string): Role | null {
  if (id) return guild.roles.cache.get(id) ?? null;
  return guild.roles.cache.find((r) => looseName(r.name) === looseName(name)) ?? null;
}

export function findTextChannel(guild: Guild, id: string | undefined, name: string): TextChannel | null {
  const ch = id
    ? guild.channels.cache.get(id)
    : guild.channels.cache.find((c) => c.type === ChannelType.GuildText && looseName(c.name) === looseName(name));
  return ch?.type === ChannelType.GuildText ? ch : null;
}

/** Resolve cargos e canais; lança erro listando o que falta (rode `bun run setup`). */
export async function resolveResources(guild: Guild, env: BotEnv): Promise<Resources> {
  await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
  const missing: string[] = [];
  const role = (id: string | undefined, name: string) => {
    const r = findRole(guild, id, name);
    if (!r) missing.push(`cargo "${name}"${id ? ` (ID ${id})` : ""}`);
    return r!;
  };
  const roles = {
    participante: role(env.ROLE_PARTICIPANTE_ID, RESOURCE_NAMES.participante),
    mentor: role(env.ROLE_MENTOR_ID, RESOURCE_NAMES.mentor),
    organizacao: role(env.ROLE_ORGANIZACAO_ID, RESOURCE_NAMES.organizacao),
  };
  const checkin = findTextChannel(guild, env.CHANNEL_CHECKIN_ID, RESOURCE_NAMES.checkin);
  if (!checkin) missing.push(`canal #${RESOURCE_NAMES.checkin}`);
  if (missing.length) {
    throw new Error(`Não encontrei no servidor: ${missing.join(", ")}. Rode \`bun run setup\` ou ajuste os IDs no .env.`);
  }
  return {
    roles,
    channels: {
      checkin: checkin!,
      filaMentoria: findTextChannel(guild, env.CHANNEL_FILA_MENTORIA_ID, RESOURCE_NAMES.filaMentoria),
      botLogs: findTextChannel(guild, env.CHANNEL_BOT_LOGS_ID, RESOURCE_NAMES.botLogs),
    },
  };
}
