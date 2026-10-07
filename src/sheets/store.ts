import type { Logger } from "../logger";
import { buildDeclaredGroups, type DeclaredGroup, type GroupingResult } from "../teams/grouping";
import { normalizeEmail } from "../teams/normalize";
import type { SheetSource } from "./client";
import { parseSheet } from "./parse";
import type { Inscricao, ParsedSheet } from "./types";

export interface Snapshot {
  sheet: ParsedSheet;
  grouping: GroupingResult;
  loadedAt: Date;
}

export type RefreshResult =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; error: string; /** Cache em uso (se houver). */ snapshot: Snapshot | null };

/**
 * Cache em memória das inscrições. Se a API falhar, mantém o último
 * resultado válido. Chamadas simultâneas de refresh() compartilham a mesma leitura.
 */
export class InscricoesStore {
  private current: Snapshot | null = null;
  private inflight: Promise<RefreshResult> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly source: SheetSource,
    private readonly opts: { maxTeamSize: number; refreshMinutes: number; logger: Logger },
  ) {}

  get snapshot(): Snapshot | null {
    return this.current;
  }

  refresh(): Promise<RefreshResult> {
    this.inflight ??= this.doRefresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doRefresh(): Promise<RefreshResult> {
    const log = this.opts.logger;
    try {
      const values = await this.source.fetchValues();
      const sheet = parseSheet(values);
      if (sheet.all.length === 0 && this.current && this.current.sheet.all.length > 0) {
        // Proteção: planilha veio vazia/sem colunas — provavelmente erro de acesso ou de intervalo.
        throw new Error(
          `planilha retornou 0 inscrições válidas (${sheet.issues.map((i) => i.message).join("; ") || "sem detalhes"})`,
        );
      }
      const grouping = buildDeclaredGroups(sheet.all, { maxSize: this.opts.maxTeamSize });
      this.current = { sheet, grouping, loadedAt: new Date() };
      log.info(
        {
          inscricoes: sheet.all.length,
          grupos: grouping.groups.length,
          problemasPlanilha: sheet.issues.length,
          problemasAgrupamento: grouping.issues.length,
        },
        "sheets: cache atualizado",
      );
      return { ok: true, snapshot: this.current };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error({ err: error, cacheDe: this.current?.loadedAt }, "sheets: falha ao atualizar; usando cache");
      return { ok: false, error, snapshot: this.current };
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.refresh(), this.opts.refreshMinutes * 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  findByEmail(rawEmail: string): Inscricao | undefined {
    return this.current?.sheet.byEmail.get(normalizeEmail(rawEmail));
  }

  declaredGroupOf(email: string): DeclaredGroup | undefined {
    return this.current?.grouping.byEmail.get(normalizeEmail(email));
  }
}
