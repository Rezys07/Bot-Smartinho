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
import "./commands/checkinButton";
import "./commands/help";
import { createDeclaredTeams } from "./admin/equipes";
import { handleInteraction } from "./commands/interactions";
import { startMentoringAlerts, topicMentorIds } from "./mentoring/discord";
import { MentoringRequests } from "./mentoring/requests";
import { loadTopics } from "./mentoring/topics";
import { StaffSync } from "./staff/sync";
import { ensureCheckinInstructions } from "./commands/checkinInstructions";
import { GoogleSheetSource } from "./sheets/client";
import { InscricoesStore } from "./sheets/store";
import { CheckinService } from "./teams/checkin";
import { DiscordTeamGateway } from "./teams/discordGateway";
import { loadDesafios } from "./teams/desafios";
import { messages } from "./i18n";
import { join } from "node:path";
import { Mutex } from "./util/mutex";
import { SlidingWindowLimiter } from "./util/rateLimiter";

/** Arquivos editáveis pela organização, dentro de CONFIG_DIR (um por servidor). */
const configFiles = (dir: string) => ({
  desafios: join(dir, "desafios.json"),
  mensagemCheckin: join(dir, "mensagem-checkin.md"),
  mentoria: join(dir, "mentoria.json"),
});

async function main() {
  const env = loadBotEnv();
  const sheetsEnv = loadSheetsEnv();
  const t = messages(env.BOT_LANGUAGE);
  const CONFIG = configFiles(env.CONFIG_DIR);
  logger.info({ idioma: env.BOT_LANGUAGE, config: env.CONFIG_DIR, banco: env.DATABASE_PATH }, "configuração");
  const repo = new Repo(openDatabase(env.DATABASE_PATH));
  const desafios = loadDesafios(CONFIG.desafios);
  const topics = loadTopics(CONFIG.mentoria);
  const mentoring = new MentoringRequests(repo.db);
  let stopAlerts: (() => void) | null = null;
  let staff: StaffSync | null = null;

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
      // Cache completo de membros: necessário para achar mentores por nome (temas de mentoria).
      await guild.members.fetch();
      const resources = await resolveResources(guild, env, t.defaults);
      const gateway = new DiscordTeamGateway(
        guild,
        repo,
        resources.roles,
        env.TEAMS_PER_CATEGORY,
        (id) => desafios.find((d) => d.id === id)?.nome ?? id,
        t,
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
        mentoring,
        topics,
        audit: makeAudit(resources.channels.botLogs),
        t,
      };
      const readyCtx = ctx;
      stopAlerts = startMentoringAlerts(readyCtx);
      for (const t of topics) {
        const { unresolved } = topicMentorIds(readyCtx, t);
        if (unresolved.length) {
          await readyCtx.audit(
            `⚠️ Tema de mentoria "${t.nome}": não achei o mentor ${unresolved.map((u) => `"${u}"`).join(", ")} entre quem tem o cargo Mentor (ou o nome bate com mais de um). Ajuste config/mentoria.json.`,
          );
        }
      }
      if (!resources.channels.botLogs) logger.warn("canal #bot-logs não encontrado; registros só no log do processo");
      await ensureCheckinInstructions(readyCtx, CONFIG.mensagemCheckin);

      // Canais de todas as equipes da planilha, antes do check-in (opcional).
      if (env.CRIAR_EQUIPES_ANTECIPADO) {
        await createDeclaredTeams(readyCtx);
        store.onRefresh(() => void createDeclaredTeams(readyCtx).catch((err) => logger.error({ err: String(err) }, "falha ao criar equipes")));
      }

      // Mentores e organização pela planilha de staff (sem check-in).
      if (sheetsEnv.STAFF_SHEET_ID) {
        staff = new StaffSync(
          readyCtx,
          new GoogleSheetSource(sheetsEnv, { sheetId: sheetsEnv.STAFF_SHEET_ID, range: sheetsEnv.STAFF_SHEET_RANGE }),
          repo.db,
        );
        if (await staff.refresh()) {
          const granted = await staff.reconcileAll();
          logger.info({ staff: staff.size, cargosDados: granted }, "staff sincronizada");
        } else {
          await readyCtx.audit("❗ Não consegui ler a planilha de mentores (STAFF_SHEET_ID). Compartilhe-a com a Service Account.");
        }
        staff.start(sheetsEnv.SHEETS_REFRESH_MINUTES);
      } else {
        logger.warn("STAFF_SHEET_ID vazio: cargos automáticos de mentor/organização desligados");
      }
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

  client.on(Events.GuildMemberAdd, (member) => {
    if (!ctx || !staff || member.guild.id !== ctx.guild.id) return;
    void staff.apply(member).catch((err) => logger.error({ err: describeDiscordError(err) }, "erro ao aplicar cargo de staff"));
  });

  client.on(Events.InteractionCreate, (i) => {
    if (!ctx) return;
    void handleInteraction(ctx, i).catch((err) => logger.error({ err: describeDiscordError(err) }, "erro ao tratar interação"));
  });

  async function shutdown(code = 0) {
    logger.info("encerrando");
    store.stop();
    stopAlerts?.();
    staff?.stop();
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
