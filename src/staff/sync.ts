import type { Database } from "bun:sqlite";
import { EmbedBuilder, type GuildMember } from "discord.js";
import type { BotContext } from "../bot/context";
import { describeDiscordError } from "../bot/messaging";
import { logger } from "../logger";
import type { SheetSource } from "../sheets/client";
import { normalizeUsername, parseStaffSheet, type ParsedStaff, type StaffEntry, type StaffRole } from "./parse";

const ROLE_LABEL: Record<StaffRole, string> = { mentor: "Mentor", organizacao: "Organização" };

function welcomeEmbed(ctx: BotContext, member: GuildMember, entry: StaffEntry): EmbedBuilder {
  const fila = ctx.channels.filaMentoria ? `<#${ctx.channels.filaMentoria.id}>` : `#${ctx.t.defaults.filaMentoria}`;
  const logs = ctx.channels.botLogs ? `<#${ctx.channels.botLogs.id}>` : `#${ctx.t.defaults.botLogs}`;
  const text =
    entry.role === "mentor" ? ctx.t.staff.mentor(`${member}`, fila) : ctx.t.staff.organizacao(`${member}`, fila, logs);
  return new EmbedBuilder().setColor(entry.role === "mentor" ? 0x2b8a3e : 0x7048e8).setDescription(text);
}

/**
 * Dá Mentor/Organização automaticamente a quem está na planilha de staff, sem check-in:
 * ao entrar no servidor e, para quem já está, a cada leitura da planilha.
 */
export class StaffSync {
  private current: ParsedStaff | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Evita repetir o mesmo alerta de falha a cada sincronização. */
  private reportedFailures = new Set<string>();

  constructor(
    private readonly ctx: BotContext,
    private readonly source: SheetSource,
    private readonly db: Database,
  ) {}

  get size(): number {
    return this.current?.byUsername.size ?? 0;
  }

  /** Lê a planilha; em caso de falha mantém a última versão. */
  async refresh(): Promise<boolean> {
    try {
      const values = await this.source.fetchValues();
      const parsed = parseStaffSheet(values, {
        organizacao: this.ctx.env.ORGANIZACAO_USUARIOS,
        hackathons: this.ctx.env.STAFF_HACKATHONS,
      });
      const firstLoad = this.current === null;
      this.current = parsed;
      logger.info({ staff: parsed.byUsername.size, problemas: parsed.issues.length }, "staff: planilha atualizada");
      if (firstLoad && parsed.issues.length) {
        await this.ctx.audit(`⚠️ Planilha de mentores:\n${parsed.issues.map((i) => `• ${i.message}`).join("\n")}`);
      }
      return true;
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "staff: falha ao ler planilha; usando cache");
      return false;
    }
  }

  private wasGranted(id: string): boolean {
    return this.grantedRole(id) !== null;
  }

  /** Cargo de staff que o bot gerencia para essa pessoa (o último que ele aplicou). */
  private grantedRole(id: string): StaffRole | null {
    const row = this.db.query<{ role: StaffRole }, [string]>("SELECT role FROM staff_grants WHERE discord_id = ?").get(id);
    return row?.role ?? null;
  }

  private roleFor(kind: StaffRole) {
    return kind === "organizacao" ? this.ctx.roles.organizacao : this.ctx.roles.mentor;
  }

  /**
   * A pessoa mudou de papel na configuração (ex.: Organização → Mentor): tira o cargo antigo
   * que o próprio bot tinha dado. Cargos dados à mão, fora da planilha, nunca são removidos.
   */
  private async removeOutdatedRole(member: GuildMember, entry: StaffEntry) {
    const previous = this.grantedRole(member.id);
    if (!previous || previous === entry.role) return;
    const old = this.roleFor(previous);
    if (member.roles.cache.has(old.id)) {
      try {
        await member.roles.remove(old, `Planilha de staff: agora é ${ROLE_LABEL[entry.role]}`);
        await this.ctx.audit(
          `🔁 <@${member.id}> deixou de ser **${ROLE_LABEL[previous]}** e passa a ser **${ROLE_LABEL[entry.role]}** (configuração da staff).`,
        );
      } catch (err) {
        const key = `rm:${member.id}:${old.id}`;
        if (!this.reportedFailures.has(key)) {
          this.reportedFailures.add(key);
          await this.ctx.audit(`❗ Não consegui remover o cargo ${ROLE_LABEL[previous]} de <@${member.id}>: ${describeDiscordError(err)}.`);
        }
        return;
      }
    }
    this.recordGrant(member.id, entry.role);
  }

  private recordGrant(id: string, role: StaffRole) {
    this.db
      .query("INSERT INTO staff_grants (discord_id, role) VALUES (?, ?) ON CONFLICT(discord_id) DO UPDATE SET role = excluded.role")
      .run(id, role);
  }

  /** Aplica o cargo se a pessoa estiver na planilha. Retorna true se deu o cargo agora. */
  async apply(member: GuildMember): Promise<boolean> {
    if (member.user.bot) return false;
    const entry = this.current?.byUsername.get(normalizeUsername(member.user.username));
    if (!entry) return false;

    await this.removeOutdatedRole(member, entry);

    const role = this.roleFor(entry.role);
    if (member.roles.cache.has(role.id)) {
      // Já tinha o cargo (dado à mão, por exemplo): só registra para não dar boas-vindas depois.
      if (this.grantedRole(member.id) !== entry.role) this.recordGrant(member.id, entry.role);
      return false;
    }

    try {
      await member.roles.add(role, `Planilha de staff: ${ROLE_LABEL[entry.role]}`);
    } catch (err) {
      const key = `${member.id}:${role.id}`;
      if (!this.reportedFailures.has(key)) {
        this.reportedFailures.add(key);
        await this.ctx.audit(
          `❗ Não consegui dar o cargo ${ROLE_LABEL[entry.role]} a <@${member.id}>: ${describeDiscordError(err)}. ` +
            "O cargo do bot precisa estar ACIMA de Mentor e Organização (Configurações do servidor → Cargos).",
        );
      }
      return false;
    }

    const firstTime = !this.wasGranted(member.id);
    this.recordGrant(member.id, entry.role);
    await this.ctx.audit(`🎓 <@${member.id}> recebeu o cargo **${ROLE_LABEL[entry.role]}** (planilha de staff, linha ${entry.row}).`);
    if (firstTime) await this.welcome(member, entry);
    return true;
  }

  /** Boas-vindas visíveis só para a staff (canal privado) + cópia por DM. */
  private async welcome(member: GuildMember, entry: StaffEntry) {
    const embed = welcomeEmbed(this.ctx, member, entry);
    const sala = this.ctx.channels.salaMentores;
    if (sala) {
      await sala
        .send({ content: `${member}`, embeds: [embed], allowedMentions: { users: [member.id] } })
        .catch((err) => logger.warn({ err: describeDiscordError(err) }, "falha ao enviar boas-vindas na sala dos mentores"));
    }
    await member.send({ embeds: [embed] }).catch(() => {
      logger.info({ user: member.id }, "staff: DM de boas-vindas bloqueada");
    });
  }

  /** Confere todos os membros atuais (na inicialização e após cada leitura). */
  async reconcileAll(): Promise<number> {
    if (!this.current) return 0;
    let granted = 0;
    for (const member of this.ctx.guild.members.cache.values()) {
      if (await this.apply(member)) granted++;
    }
    return granted;
  }

  start(minutes: number) {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      if (await this.refresh()) await this.reconcileAll();
    }, minutes * 60_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
