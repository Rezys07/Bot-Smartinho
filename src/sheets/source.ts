import type { SheetsEnv } from "../config/env";
import { GoogleSheetSource, type SheetSource } from "./client";
import { TeamsGridSource } from "./teamsGrid";

/** Monta a fonte da planilha de inscrições conforme SHEET_FORMAT. */
export function inscricoesSource(env: SheetsEnv): { source: SheetSource; grid: TeamsGridSource | null; serviceAccount: string } {
  const base = new GoogleSheetSource(env);
  if (env.SHEET_FORMAT === "simples") return { source: base, grid: null, serviceAccount: base.serviceAccountEmail };
  const grid = new TeamsGridSource(
    new GoogleSheetSource(env, { sheetId: env.GOOGLE_SHEET_ID, range: env.TEAMS_RANGE }),
    new GoogleSheetSource(env, { sheetId: env.GOOGLE_SHEET_ID, range: env.DIRECTORY_RANGE }),
  );
  return { source: grid, grid, serviceAccount: base.serviceAccountEmail };
}
