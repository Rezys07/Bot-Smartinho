import pino from "pino";

/**
 * Logger estruturado (JSON). Campos com dados pessoais são removidos mesmo
 * que alguém os passe por engano.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined,
  redact: {
    paths: [
      "email",
      "phone",
      "telefone",
      "*.email",
      "*.phone",
      "*.telefone",
      "token",
      "*.token",
      "credentials",
      "*.credentials",
    ],
    censor: "[removido]",
  },
});

export type Logger = typeof logger;
