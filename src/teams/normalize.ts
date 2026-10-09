/** Caracteres invisíveis que aparecem quando o e-mail é copiado de apps. */
const INVISIBLE = /[​-‍⁠﻿­]/g;

export function normalizeEmail(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/^mailto:/i, "")
    .replace(/^<|>$/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

/** Remove acentos, deixa minúsculo, troca pontuação/hífen por espaço e colapsa espaços. */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(INVISIBLE, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Partículas que não ajudam a identificar a pessoa ("Maria DA Silva"). */
const PARTICLES = new Set(["da", "de", "do", "das", "dos", "e", "d", "di", "du", "del", "van", "von"]);

/** "Maria da Conceição dos Santos" → ["maria", "conceicao", "santos"] (para comparar nomes). */
export function nameTokens(raw: string): string[] {
  const norm = normalizeName(raw);
  return norm ? norm.split(" ").filter((t) => !PARTICLES.has(t)) : [];
}

/** "Maria Clara da Silva Santos" → "Maria Santos" (para apelido). */
export function shortName(raw: string): string {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return titleCase(parts[0] ?? "");
  const first = parts[0]!;
  let last = parts[parts.length - 1]!;
  // Evita terminar em partícula ("... de")
  for (let i = parts.length - 1; i > 0; i--) {
    if (!PARTICLES.has(normalizeName(parts[i]!))) {
      last = parts[i]!;
      break;
    }
  }
  return `${titleCase(first)} ${titleCase(last)}`;
}

function titleCase(word: string): string {
  return word
    .toLowerCase()
    .replace(/(^|[-'])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}
