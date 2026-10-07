import { describe, expect, test } from "bun:test";
import { loadBotEnv, loadSheetsEnv } from "../src/config/env";

describe("loadSheetsEnv", () => {
  test("aceita valores colados do JSON (aspas e vírgula final)", () => {
    const env = loadSheetsEnv({
      GOOGLE_SHEET_ID: "abc",
      GOOGLE_SERVICE_ACCOUNT_EMAIL: '"bot@proj.iam.gserviceaccount.com",',
      GOOGLE_PRIVATE_KEY: '"-----BEGIN PRIVATE KEY-----\\nAAA\\n-----END PRIVATE KEY-----\\n",',
    });
    expect(env.GOOGLE_SERVICE_ACCOUNT_EMAIL).toBe("bot@proj.iam.gserviceaccount.com");
    expect(env.GOOGLE_PRIVATE_KEY?.startsWith("-----BEGIN")).toBe(true);
    expect(env.GOOGLE_SHEET_RANGE).toBe("Página1");
  });

  test("exige alguma credencial e não vaza valores no erro", () => {
    expect(() => loadSheetsEnv({ GOOGLE_SHEET_ID: "segredo-123" })).toThrow(/GOOGLE_PRIVATE_KEY/);
    try {
      loadSheetsEnv({ GOOGLE_SHEET_ID: "segredo-123" });
    } catch (e) {
      expect(String(e)).not.toContain("segredo-123");
    }
  });
});

describe("loadBotEnv", () => {
  test("padrões e IDs opcionais vazios", () => {
    const env = loadBotEnv({ DISCORD_TOKEN: "t", DISCORD_GUILD_ID: "123", ROLE_MENTOR_ID: "" });
    expect(env.TEAM_MAX_SIZE).toBe(5);
    expect(env.ROLE_MENTOR_ID).toBeUndefined();
    expect(env.EQUIPES_PLANILHA_ABERTAS).toBe(false);
  });
  test("prazo inválido", () => {
    expect(() => loadBotEnv({ DISCORD_TOKEN: "t", DISCORD_GUILD_ID: "1", DESAFIO_PRAZO: "amanhã" })).toThrow(/DESAFIO_PRAZO/);
  });
});
