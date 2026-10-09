import { en } from "./en";
import { pt, type Messages } from "./pt";

export type Language = "pt" | "en";
export type { Messages };

export function messages(lang: Language): Messages {
  return lang === "en" ? en : pt;
}
