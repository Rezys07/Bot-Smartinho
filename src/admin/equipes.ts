import type { BotContext } from "../bot/context";
import { registerCommand } from "../commands/router";
import { logger } from "../logger";

/** Cria canais das equipes da planilha que ainda não existem e registra no #bot-logs. */
export async function createDeclaredTeams(ctx: BotContext): Promise<{ created: number; errors: number }> {
  const r = await ctx.checkin.ensureDeclaredTeams();
  if (r.created.length) {
    await ctx.audit(
      `🏗️ Equipes criadas a partir da planilha: ${r.created
        .map((t) => `**${ctx.t.teamName(t.number)}** (${t.sheet_label})`)
        .join(", ")}`,
    );
  }
  if (r.relabeled.length) {
    await ctx.audit(
      `✏️ Nome na planilha atualizado: ${r.relabeled.map((t) => `**${ctx.t.teamName(t.number)}** → ${t.sheet_label}`).join(", ")}`,
    );
  }
  if (r.errors.length) await ctx.audit(`❗ Falha ao criar canais de equipe: ${r.errors.join("; ")}`);
  logger.info({ criadas: r.created.length, erros: r.errors.length }, "equipes da planilha conferidas");
  return { created: r.created.length, errors: r.errors.length };
}

// !criar-equipes / !create-teams — relê a planilha e cria o que faltar (só organização).
registerCommand(["criar-equipes", "criarequipes", "create-teams", "createteams"], {
  staffOnly: true,
  async run(ctx, msg) {
    const refresh = await ctx.store.refresh();
    const r = await createDeclaredTeams(ctx);
    const total = ctx.store.snapshot?.sheet.teams.size ?? 0;
    await msg.reply({
      content:
        (refresh.ok ? "" : "⚠️ Não consegui reler a planilha; usei a última versão. ") +
        `Equipes na planilha: ${total}. Criadas agora: ${r.created}.` +
        (r.errors ? ` Falhas: ${r.errors} (veja #bot-logs).` : ""),
      allowedMentions: { repliedUser: false },
    });
  },
});
