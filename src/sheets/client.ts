import { JWT } from "google-auth-library";
import type { SheetsEnv } from "../config/env";
import { logger } from "../logger";
import { withRetry } from "../util/retry";

export class SheetsHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Só vale repetir limite de uso, erro do servidor ou falha de rede — não credencial inválida. */
export function isTransient(err: unknown): boolean {
  if (err instanceof SheetsHttpError) return err.status === 429 || err.status >= 500;
  const e = err as { name?: string; code?: string; message?: string };
  if (e?.name === "TypeError" || e?.name === "TimeoutError" || e?.name === "AbortError") return true;
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed/i.test(`${e?.code ?? ""} ${e?.message ?? ""}`);
}

export interface SheetSource {
  fetchValues(): Promise<unknown[][]>;
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function resolveKey(env: SheetsEnv): ServiceAccountKey {
  if (env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_PRIVATE_KEY) {
    return {
      client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      // No .env a chave costuma vir com "\n" literais.
      private_key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    };
  }
  return decodeKey(env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 ?? "");
}

function decodeKey(b64: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 não é um JSON em base64 válido.");
  }
  const key = parsed as Partial<ServiceAccountKey>;
  if (!key.client_email || !key.private_key) {
    throw new Error("Chave da Service Account sem client_email/private_key.");
  }
  return { client_email: key.client_email, private_key: key.private_key };
}

/** Lê a planilha pela Sheets API v4 (somente leitura). */
export class GoogleSheetSource implements SheetSource {
  private readonly jwt: JWT;
  readonly serviceAccountEmail: string;

  constructor(private readonly env: SheetsEnv) {
    const key = resolveKey(env);
    this.serviceAccountEmail = key.client_email;
    this.jwt = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
  }

  async fetchValues(): Promise<unknown[][]> {
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.env.GOOGLE_SHEET_ID)}` +
      `/values/${encodeURIComponent(this.env.GOOGLE_SHEET_RANGE)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;

    return withRetry(
      async () => {
        const { token } = await this.jwt.getAccessToken();
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
          // O corpo de erro do Google não contém dados da planilha, mas limitamos o tamanho.
          const body = (await res.text()).slice(0, 300);
          throw new SheetsHttpError(res.status, `Sheets API ${res.status}: ${body}`);
        }
        const data = (await res.json()) as { values?: unknown[][] };
        return data.values ?? [];
      },
      {
        retries: 4,
        shouldRetry: isTransient,
        onRetry: (err, attempt, delayMs) =>
          logger.warn({ attempt, delayMs, err: String(err) }, "sheets: falha ao ler, tentando novamente"),
      },
    );
  }
}
