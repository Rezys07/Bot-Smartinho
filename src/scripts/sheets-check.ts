/**
 * Verifica o acesso à planilha e mostra um resumo SEM dados pessoais.
 * Uso: bun run sheets:check
 */
import { loadSheetsEnv } from "../config/env";
import { GoogleSheetSource } from "../sheets/client";
import { parseSheet } from "../sheets/parse";

const maxTeamSize = Number(process.env.TEAM_MAX_SIZE ?? 5) || 5;

try {
  const env = loadSheetsEnv();
  const source = new GoogleSheetSource(env);
  console.log(`Service Account: ${source.serviceAccountEmail}`);
  console.log(`Lendo a aba "${env.GOOGLE_SHEET_RANGE}"...`);
  const values = await source.fetchValues();
  const sheet = parseSheet(values, { maxTeamSize });

  console.log(`\nCabeçalho: ${JSON.stringify(values[0] ?? [])}`);
  console.log(`Linhas (sem cabeçalho): ${Math.max(0, values.length - 1)}`);
  console.log(`Inscrições válidas: ${sheet.all.length}`);
  console.log(`  com equipe definida: ${sheet.all.filter((i) => i.equipeKey).length}`);
  console.log(`  individuais: ${sheet.all.filter((i) => !i.equipeKey).length}`);

  const sizes = new Map<number, number>();
  for (const t of sheet.teams.values()) sizes.set(t.members.length, (sizes.get(t.members.length) ?? 0) + 1);
  console.log(`Equipes na planilha: ${sheet.teams.size}`);
  for (const [s, n] of [...sizes].sort((a, b) => a[0] - b[0])) console.log(`  com ${s} pessoa(s): ${n}`);

  console.log("\nProblemas:");
  if (sheet.issues.length === 0) console.log("  nenhum");
  // Mensagens não contêm e-mail; só linhas, nomes de equipe e colunas.
  for (const i of sheet.issues) console.log(`  - ${i.message}`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nFalha: ${msg}`);
  if (msg.includes("403")) {
    console.error("Dica: compartilhe a planilha com o e-mail da Service Account (Leitor) e ative a Google Sheets API no projeto.");
  } else if (msg.includes("404")) {
    console.error("Dica: confira GOOGLE_SHEET_ID (trecho da URL entre /d/ e /edit).");
  } else if (msg.includes("400")) {
    console.error("Dica: confira GOOGLE_SHEET_RANGE (nome exato da aba).");
  }
  process.exit(1);
}
