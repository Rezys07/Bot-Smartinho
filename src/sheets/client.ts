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

export interface SheetSource {
  fetchValues(): Promise<unknown[][]>;
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
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
    const key = decodeKey(env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64);
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
        shouldRetry: (err) =>
          !(err instanceof SheetsHttpError) || err.status === 429 || err.status >= 500,
        onRetry: (err, attempt, delayMs) =>
          logger.warn({ attempt, delayMs, err: String(err) }, "sheets: falha ao ler, tentando novamente"),
      },
    );
  }
}
