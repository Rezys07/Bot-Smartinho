/**
 * Prepara o servidor (idempotente): cria o que falta e valida permissões, sem duplicar nada.
 * Uso: bun run setup
 */
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type Guild,
  type OverwriteResolvable,
  PermissionFlagsBits as P,
  PermissionsBitField,
  type Role,
  type TextChannel,
} from "discord.js";
import { loadBotEnv } from "../config/env";
import { findRole, findTextChannel, looseName, RESOURCE_NAMES } from "../bot/resources";
import { describeDiscordError } from "../bot/messaging";

/** Permissões que o bot precisa no servidor (mesmas do link de convite). */
export const REQUIRED_BOT_PERMISSIONS = [
  P.ViewChannel,
  P.SendMessages,
  P.ReadMessageHistory,
  P.EmbedLinks,
  P.AttachFiles,
  P.AddReactions,
  P.ManageChannels,
  P.ManageRoles,
  P.ManageNicknames,
  P.ManageMessages,
  P.Connect,
  P.Speak,
  P.Stream,
  P.UseVAD,
];

const BOT_CATEGORY = "BOT HACKATHON";

const env = loadBotEnv();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const done: string[] = [];
const warnings: string[] = [];

async function ensureRole(guild: Guild, id: string | undefined, name: string): Promise<Role> {
  const found = findRole(guild, id, name);
  if (found) {
    done.push(`cargo "${found.name}" já existe`);
    return found;
  }
  if (id) throw new Error(`O ID de cargo ${id} configurado para "${name}" não existe no servidor.`);
  const role = await guild.roles.create({ name, permissions: [], mentionable: false, reason: "Setup do bot do hackathon" });
  done.push(`cargo "${name}" CRIADO`);
  return role;
}

async function ensureCategory(guild: Guild, overwrites: OverwriteResolvable[]): Promise<string> {
  const existing = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && looseName(c.name) === looseName(BOT_CATEGORY),
  );
  if (existing) return existing.id;
  done.push(`categoria "${BOT_CATEGORY}" CRIADA`);
  return (await guild.channels.create({ name: BOT_CATEGORY, type: ChannelType.GuildCategory, permissionOverwrites: overwrites })).id;
}

async function ensurePrivateChannel(
  guild: Guild,
  id: string | undefined,
  name: string,
  overwrites: OverwriteResolvable[],
  topic: string,
): Promise<TextChannel> {
  const found = findTextChannel(guild, id, name);
  if (found) {
    done.push(`canal #${found.name} já existe`);
    if (found.permissionsFor(guild.roles.everyone).has(P.ViewChannel)) {
      warnings.push(`#${found.name} está visível para @everyone — deveria ser privado.`);
    }
    return found;
  }
  if (id) throw new Error(`O ID de canal ${id} configurado para "#${name}" não existe no servidor.`);
  const parent = await ensureCategory(guild, overwrites);
  const ch = await guild.channels.create({ name, type: ChannelType.GuildText, parent, topic, permissionOverwrites: overwrites });
  done.push(`canal #${name} CRIADO (privado)`);
  return ch;
}

client.once(Events.ClientReady, async (ready) => {
  try {
    const guild = await ready.guilds.fetch(env.DISCORD_GUILD_ID);
    await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
    const me = await guild.members.fetchMe();
    console.log(`Servidor: ${guild.name}\nBot: ${me.user.tag}\n`);

    // 1. Permissões do bot no servidor
    const missing = new PermissionsBitField(REQUIRED_BOT_PERMISSIONS).remove(me.permissions).toArray();
    if (missing.length && !me.permissions.has(P.Administrator)) {
      throw new Error(`O bot não tem estas permissões no servidor: ${missing.join(", ")}. Convide de novo com o link do \`bun run discord:check\`.`);
    }
    done.push("permissões do bot no servidor OK");

    // 2. Cargos
    const organizacao = await ensureRole(guild, env.ROLE_ORGANIZACAO_ID, RESOURCE_NAMES.organizacao);
    const mentor = await ensureRole(guild, env.ROLE_MENTOR_ID, RESOURCE_NAMES.mentor);
    const participante = await ensureRole(guild, env.ROLE_PARTICIPANTE_ID, RESOURCE_NAMES.participante);
    if (me.roles.highest.comparePositionTo(participante) <= 0) {
      warnings.push(
        `O cargo do bot ("${me.roles.highest.name}") está abaixo de "${participante.name}". ` +
          "Em Configurações do servidor → Cargos, arraste o cargo do bot para cima dele.",
      );
    }

    // 3. Canais privados do bot
    const botAllow = { id: me.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.ManageMessages] };
    const everyoneDeny = { id: guild.roles.everyone.id, deny: [P.ViewChannel] };
    const read = [P.ViewChannel, P.ReadMessageHistory, P.SendMessages];
    const logs = await ensurePrivateChannel(
      guild,
      env.CHANNEL_BOT_LOGS_ID,
      RESOURCE_NAMES.botLogs,
      [everyoneDeny, botAllow, { id: organizacao.id, allow: read }],
      "Registros do bot (só organização). Sem dados pessoais.",
    );
    const fila = await ensurePrivateChannel(
      guild,
      env.CHANNEL_FILA_MENTORIA_ID,
      RESOURCE_NAMES.filaMentoria,
      [everyoneDeny, botAllow, { id: organizacao.id, allow: read }, { id: mentor.id, allow: read }],
      "Pedidos de mentoria das equipes. Clique em Atender para assumir.",
    );

    // 4. #check-in: bot precisa apagar mensagens (e-mails) lá
    const checkin = findTextChannel(guild, env.CHANNEL_CHECKIN_ID, RESOURCE_NAMES.checkin);
    if (!checkin) {
      warnings.push("Canal #check-in não encontrado. Crie um canal com 'check-in' no nome ou defina CHANNEL_CHECKIN_ID.");
    } else {
      const perms = checkin.permissionsFor(me);
      const need = [P.ViewChannel, P.SendMessages, P.ManageMessages, P.ReadMessageHistory];
      const lacking = new PermissionsBitField(need).remove(perms).toArray();
      if (lacking.length) warnings.push(`No #${checkin.name} o bot não tem: ${lacking.join(", ")}.`);
      else done.push(`#${checkin.name}: bot pode ler, responder e apagar mensagens`);
    }

    console.log("Feito:");
    for (const d of done) console.log(`  ✔ ${d}`);
    if (warnings.length) {
      console.log("\nAtenção:");
      for (const w of warnings) console.log(`  ⚠ ${w}`);
    }
    console.log("\nIDs (opcional colocar no .env para não depender dos nomes):");
    console.log(`  ROLE_PARTICIPANTE_ID=${participante.id}`);
    console.log(`  ROLE_MENTOR_ID=${mentor.id}`);
    console.log(`  ROLE_ORGANIZACAO_ID=${organizacao.id}`);
    if (checkin) console.log(`  CHANNEL_CHECKIN_ID=${checkin.id}`);
    console.log(`  CHANNEL_FILA_MENTORIA_ID=${fila.id}`);
    console.log(`  CHANNEL_BOT_LOGS_ID=${logs.id}`);
    await client.destroy();
    process.exit(warnings.length ? 2 : 0);
  } catch (err) {
    console.error(`\nFalha: ${describeDiscordError(err)}`);
    await client.destroy();
    process.exit(1);
  }
});

await client.login(env.DISCORD_TOKEN);
