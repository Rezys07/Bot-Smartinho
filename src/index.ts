import { Client, Events, GatewayIntentBits, Partials, RESTEvents } from "discord.js";
import { loadBotEnv, loadSheetsEnv } from "./config/env";
import { openDatabase } from "./db";
import { Repo } from "./db/repo";
import { logger } from "./logger";
import type { BotContext } from "./bot/context";
import { describeDiscordError, makeAudit } from "./bot/messaging";
import { resolveResources } from "./bot/resources";
import { handleMessage } from "./commands/router";
import "./commands/desafio";
import { ensureCheckinInstructions } from "./commands/checkinInstructions";
import { GoogleSheetSource } from "./sheets/client";
import { InscricoesStore } from "./sheets/store";
import { CheckinService } from "./teams/checkin";
import { DiscordTeamGateway } from "./teams/discordGateway";
import { loadDesafios } from "./teams/desafios";
import { Mutex } from "./util/mutex";
import { SlidingWindowLimiter } from "./util/rateLimiter";

/** Arquivos editáveis pela organização (relativos à pasta do projeto). */
const CONFIG = {
  desafios: "config/desafios.json",
  mensagemCheckin: "config/mensagem-checkin.md",
};

async function main() {
  const env = loadBotEnv();
  const sheetsEnv = loadSheetsEnv();
  const repo = new Repo(openDatabase(env.DATABASE_PATH));
  const desafios = loadDesafios(CONFIG.desafios);

  const store = new InscricoesStore(new GoogleSheetSource(sheetsEnv), {
    maxTeamSize: env.TEAM_MAX_SIZE,
    refreshMinutes: sheetsEnv.SHEETS_REFRESH_MINUTES,
    logger,
  });
  const first = await store.refresh();
  if (!first.ok) logger.error("planilha indisponível na inicialização; check-ins serão recusados até o próximo sync");
  store.start();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.GuildMember],
  });

  client.rest.on(RESTEvents.RateLimited, (info) =>
    logger.warn({ route: info.route, retryAfter: info.retryAfter, global: info.global }, "discord: rate limit"),
  );
  client.on(Events.Error, (err) => logger.error({ err: describeDiscordError(err) }, "discord: erro no cliente"));
  client.on(Events.Warn, (msg) => logger.warn({ msg }, "discord: aviso"));

  let ctx: BotContext | null = null;

  client.once(Events.ClientReady, async (ready) => {
    try {
      const guild = await ready.guilds.fetch(env.DISCORD_GUILD_ID);
      await guild.members.fetchMe();
      const resources = await resolveResources(guild, env);
      const gateway = new DiscordTeamGateway(
        guild,
        repo,
        resources.roles,
        env.TEAMS_PER_CATEGORY,
        (id) => desafios.find((d) => d.id === id)?.nome ?? id,
      );
      const checkin = new CheckinService({
        repo,
        store,
        gateway,
        limiter: new SlidingWindowLimiter(env.CHECKIN_MAX_TENTATIVAS, env.CHECKIN_JANELA_MINUTOS * 60_000),
        mutex: new Mutex(),
        maxTeamSize: env.TEAM_MAX_SIZE,
        sheetTeamsOpen: env.EQUIPES_PLANILHA_ABERTAS,
      });
      ctx = {
        ...resources,
        client: ready,
        guild,
        env,
        repo,
        store,
        checkin,
        gateway,
        desafios,
        audit: makeAudit(resources.channels.botLogs),
      };
      if (!resources.channels.botLogs) logger.warn("canal #bot-logs não encontrado; registros só no log do processo");
      await ensureCheckinInstructions(ctx, CONFIG.mensagemCheckin);
      logger.info({ user: ready.user.tag, guild: guild.name, desafios: desafios.length }, "bot pronto");
      await ctx.audit(
        `🤖 Bot iniciado. Inscrições carregadas: ${store.snapshot?.sheet.all.length ?? "planilha indisponível"}.`,
      );
    } catch (err) {
      const message = describeDiscordError(err);
      logger.fatal({ err: message, dica: startupHint(message) }, "falha na inicialização");
      await shutdown(1);
    }
  });

  client.on(Events.MessageCreate, (msg) => {
    if (!ctx) return;
    void handleMessage(ctx, msg).catch((err) => logger.error({ err: describeDiscordError(err) }, "erro ao tratar mensagem"));
  });

  async function shutdown(code = 0) {
    logger.info("encerrando");
    store.stop();
    await client.destroy().catch(() => undefined);
    repo.db.close();
    process.exit(code);
  }
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await client.login(env.DISCORD_TOKEN);
}

/** Dicas para os erros de inicialização mais comuns. */
function startupHint(message: string): string | undefined {
  if (/disallowed intents/i.test(message)) {
    return "Ative 'Server Members Intent' e 'Message Content Intent' em discord.com/developers/applications → sua aplicação → Bot → Privileged Gateway Intents, e salve.";
  }
  if (/invalid token/i.test(message)) {
    return "DISCORD_TOKEN inválido. Gere outro em Developer Portal → Bot → Reset Token e cole no .env (sem aspas).";
  }
  if (/Unknown Guild|Missing Access/i.test(message)) {
    return "Confira DISCORD_GUILD_ID e se o bot foi convidado para o servidor.";
  }
  return undefined;
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.fatal({ err: message, dica: startupHint(message) }, "falha ao iniciar");
  process.exit(1);
});
