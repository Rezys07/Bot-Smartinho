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

export function nameTokens(raw: string): string[] {
  const norm = normalizeName(raw);
  if (!norm) return [];
  return norm.split(" ").filter((t) => t && !PARTICLES.has(t) && !/^\d+$/.test(t));
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

/** Distância de edição (Levenshtein), com limite para cortar cedo. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Tokens iguais, ou com 1 erro de digitação quando ambos têm 5+ letras. */
export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  return editDistance(a, b, 1) <= 1;
}
