import { z } from "zod";

const optionalId = z
  .string()
  .trim()
  .regex(/^\d*$/, "deve ser um ID numérico do Discord")
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const intWithDefault = (def: number, min = 1) =>
  z.coerce.number().int().min(min).default(def);

/**
 * Aceita valores colados direto do JSON da chave: remove vírgula final e aspas
 * que sobraram ("valor", → valor).
 */
const pastedValue = z
  .string()
  .optional()
  .transform((v) => {
    const s = (v ?? "").trim().replace(/,$/, "").trim().replace(/^"([\s\S]*)"$/, "$1");
    return s ? s : undefined;
  });

const sheetsSchema = z
  .object({
    GOOGLE_SHEET_ID: z.string().trim().min(1, "obrigatório"),
    GOOGLE_SHEET_RANGE: z.string().trim().min(1).default("Página1"),
    // Opção A: e-mail + chave privada (com \n literais, como vem no JSON)
    GOOGLE_SERVICE_ACCOUNT_EMAIL: pastedValue,
    GOOGLE_PRIVATE_KEY: pastedValue,
    // Opção B: JSON inteiro da chave em base64
    GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: pastedValue,
    SHEETS_REFRESH_MINUTES: intWithDefault(5),
  })
  .refine(
    (e) => e.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || (e.GOOGLE_SERVICE_ACCOUNT_EMAIL && e.GOOGLE_PRIVATE_KEY),
    {
      message: "defina GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY, ou GOOGLE_SERVICE_ACCOUNT_JSON_BASE64",
      path: ["GOOGLE_PRIVATE_KEY"],
    },
  );

const botSchema = z.object({
  DISCORD_TOKEN: z.string().trim().min(1, "obrigatório"),
  DISCORD_GUILD_ID: z.string().trim().regex(/^\d+$/, "obrigatório (ID numérico)"),
  ROLE_PARTICIPANTE_ID: optionalId,
  ROLE_MENTOR_ID: optionalId,
  ROLE_ORGANIZACAO_ID: optionalId,
  CHANNEL_CHECKIN_ID: optionalId,
  CHANNEL_FILA_MENTORIA_ID: optionalId,
  CHANNEL_BOT_LOGS_ID: optionalId,
  TEAM_MAX_SIZE: intWithDefault(5, 2),
  TEAMS_PER_CATEGORY: z.coerce.number().int().min(1).max(25).default(25),
  EQUIPES_PLANILHA_ABERTAS: z
    .string()
    .optional()
    .transform((v) => ["true", "1", "sim", "yes"].includes((v ?? "").trim().toLowerCase())),
  DESAFIO_PRAZO: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: "custom", message: "data ISO 8601 inválida" });
        return z.NEVER;
      }
      return d;
    }),
  MENTORIA_ALERTA_MINUTOS: intWithDefault(15),
  CHECKIN_MAX_TENTATIVAS: intWithDefault(5),
  CHECKIN_JANELA_MINUTOS: intWithDefault(15),
  DATABASE_PATH: z.string().trim().min(1).default("./data/bot.sqlite"),
});

export type SheetsEnv = z.infer<typeof sheetsSchema>;
export type BotEnv = z.infer<typeof botSchema>;

function parseOrExit<T extends z.ZodType>(schema: T, source: Record<string, string | undefined>): z.infer<T> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  // Mostra só o nome da variável e o problema, nunca o valor.
  const problems = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Configuração inválida no .env:\n${problems}`);
}

export function loadSheetsEnv(source: Record<string, string | undefined> = process.env): SheetsEnv {
  return parseOrExit(sheetsSchema, source);
}

export function loadBotEnv(source: Record<string, string | undefined> = process.env): BotEnv {
  return parseOrExit(botSchema, source);
}
