/**
 * Verifica o acesso à planilha e mostra um resumo SEM dados pessoais.
 * Uso: bun run sheets:check            (resumo)
 *      bun run sheets:check --detalhes (inclui nomes nos alertas de agrupamento — só para a organização)
 */
import { loadSheetsEnv } from "../config/env";
import { GoogleSheetSource } from "../sheets/client";
import { parseSheet } from "../sheets/parse";
import { MODE_LABEL } from "../sheets/types";
import { buildDeclaredGroups } from "../teams/grouping";

const showDetails = process.argv.includes("--detalhes");
const maxSize = Number(process.env.TEAM_MAX_SIZE ?? 5) || 5;

try {
  const env = loadSheetsEnv();
  const source = new GoogleSheetSource(env);
  console.log(`Service Account: ${source.serviceAccountEmail}`);
  console.log("Lendo a planilha...");
  const values = await source.fetchValues();
  const sheet = parseSheet(values);
  const grouping = buildDeclaredGroups(sheet.all, { maxSize });

  const count = <T>(xs: T[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<T, number>());

  console.log(`\nLinhas lidas (sem cabeçalho): ${Math.max(0, values.length - 1)}`);
  console.log(`Inscrições válidas: ${sheet.all.length}`);
  console.log("Por modo:");
  for (const [modo, n] of count(sheet.all.map((i) => i.modo))) {
    console.log(`  ${modo ? `${modo} (${MODE_LABEL[modo]})` : "não reconhecido"}: ${n}`);
  }

  console.log("\nProblemas na planilha:");
  const sheetIssues = count(sheet.issues.map((i) => i.kind));
  if (sheetIssues.size === 0) console.log("  nenhum");
  for (const [k, n] of sheetIssues) console.log(`  ${k}: ${n}`);
  for (const i of sheet.issues.filter((i) => i.kind === "missing_column")) console.log(`  - ${i.message}`);

  const sizes = count(grouping.groups.map((g) => g.members.length));
  console.log(`\nGrupos declarados: ${grouping.groups.length}`);
  for (const [s, n] of [...sizes].sort((a, b) => a[0] - b[0])) console.log(`  com ${s} inscrito(s): ${n}`);
  console.log(`  abertos (aceitam individuais): ${grouping.groups.filter((g) => g.open).length}`);
  console.log(`  nomes citados sem inscrição: ${grouping.groups.reduce((s, g) => s + g.unregistered.length, 0)}`);

  console.log("\nAlertas de agrupamento:");
  const groupIssues = count(grouping.issues.map((i) => i.kind));
  if (groupIssues.size === 0) console.log("  nenhum");
  for (const [k, n] of groupIssues) console.log(`  ${k}: ${n}`);
  if (showDetails) {
    for (const i of grouping.issues) console.log(`  - [${i.kind}] ${i.message}`);
  } else if (grouping.issues.length > 0) {
    console.log("  (use --detalhes para ver nomes e linhas)");
  }
} catch (err) {
  console.error(`\nFalha: ${err instanceof Error ? err.message : String(err)}`);
  if (String(err).includes("403")) {
    console.error("Dica: compartilhe a planilha com o e-mail da Service Account (Leitor) e ative a Google Sheets API no projeto.");
  }
  if (String(err).includes("404")) {
    console.error("Dica: confira GOOGLE_SHEET_ID (trecho da URL entre /d/ e /edit).");
  }
  if (String(err).includes("400")) {
    console.error("Dica: confira GOOGLE_SHEET_RANGE (nome exato da aba).");
  }
  process.exit(1);
}
