import { nameTokens } from "./normalize";

/** Respostas que significam "não tenho integrantes". */
const EMPTY_ANSWERS = new Set([
  "",
  "sem equipe",
  "nenhum",
  "nenhuma",
  "ninguem",
  "nao",
  "nao tenho",
  "nao possuo",
  "n a",
  "na",
  "x",
  "ainda nao",
  "nao sei",
]);

/** Rótulos no início de um item: "Integrantes: ...", "Membros - ...". */
const LABEL_PREFIX = /^\s*(integrantes?|membros?|nomes?|equipe|time|participantes?)\s*[:\-–]\s*/i;
/** Numeração e marcadores: "1.", "2)", "3 -", "•", "-", "*". */
const BULLET_PREFIX = /^\s*(?:\d{1,2}\s*[.)\-–:º°]?\s+|\d{1,2}[.)\-–:º°]|[•·▪◦*\-–])\s*/;
/** Anotações entre parênteses/colchetes: "(eu)", "(líder)", "[curso X]". */
const ANNOTATION = /[([][^)\]]*[)\]]/g;
const EMAIL_LIKE = /\S+@\S+/g;
const PHONE_LIKE = /\+?\d[\d\s().-]{7,}\d/g;
const SELF_WORDS = new Set(["eu", "eu mesmo", "eu mesma", "proprio", "propria"]);

export interface CitedName {
  /** Texto como foi escrito (sem marcadores/anotações). */
  raw: string;
  /** Tokens normalizados sem partículas — usados no casamento. */
  tokens: string[];
}

/**
 * Converte o texto livre de "Nome dos integrantes da equipe" em uma lista de nomes.
 * Separadores aceitos: quebra de linha, vírgula, ponto e vírgula, barra, "&", "+", " e ".
 */
export function parseMemberList(text: string | null | undefined): CitedName[] {
  if (!text) return [];
  if (EMPTY_ANSWERS.has(nameTokens(text).join(" ")) || EMPTY_ANSWERS.has(simple(text))) return [];

  const cleaned = text
    .replace(/\r\n?/g, "\n")
    .replace(EMAIL_LIKE, " ")
    .replace(PHONE_LIKE, " ")
    .replace(ANNOTATION, " ");

  const pieces = cleaned
    // Também quebra numeração no meio da linha: "Ana 2) Bruno", "Ana 2. Bruno"
    .split(/\n|[,;\/|&+]|\s+e\s+|\s+-\s+|\s+–\s+|\s+(?=\d{1,2}\s*[.)\-–]\s*\p{L})/iu)
    .map((p) => p.replace(LABEL_PREFIX, "").replace(BULLET_PREFIX, "").replace(/[.:]+$/, "").trim())
    .filter(Boolean);

  const out: CitedName[] = [];
  const seen = new Set<string>();
  for (const raw of pieces) {
    const s = simple(raw);
    if (EMPTY_ANSWERS.has(s) || SELF_WORDS.has(s)) continue;
    const tokens = nameTokens(raw);
    if (tokens.length === 0 || tokens.every((t) => t.length < 2)) continue;
    const key = tokens.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ raw, tokens });
  }
  return out;
}

function simple(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "3", "3 integrantes", "três" → 3. Retorna null se não der para inferir. */
export function parseMemberCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const s = simple(text);
  if (s === "" || s.includes("sem equipe") || s === "nenhum") return 0;
  const digit = s.match(/\d+/);
  if (digit) return Number(digit[0]);
  const words: Record<string, number> = {
    um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
  };
  for (const [w, n] of Object.entries(words)) {
    if (new RegExp(`\\b${w}\\b`).test(s)) return n;
  }
  return null;
}
