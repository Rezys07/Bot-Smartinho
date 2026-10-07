export type ParticipationMode = 1 | 2 | 3;

export const MODE_LABEL: Record<ParticipationMode, string> = {
  1: "individual",
  2: "equipe formada",
  3: "equipe parcial",
};

/** Uma linha válida da planilha de inscrições. */
export interface Inscricao {
  /** Linha na planilha (1 = cabeçalho), para a organização localizar. */
  row: number;
  email: string;
  nome: string;
  telefone: string;
  instituicao: string;
  curso: string;
  areas: string[];
  modo: ParticipationMode | null;
  /** Texto bruto de "Quantos integrantes sua equipe já possui?". */
  integrantesQtdRaw: string;
  /** Texto bruto de "Nome dos integrantes da equipe". */
  integrantesRaw: string;
}

export interface SheetIssue {
  kind: "missing_column" | "invalid_email" | "unknown_mode" | "duplicate_email" | "missing_name";
  row?: number;
  /** Mensagem sem dados pessoais (sem e-mail/telefone). */
  message: string;
}

export interface ParsedSheet {
  /** Indexado pelo e-mail normalizado; em duplicatas vale a linha mais recente. */
  byEmail: Map<string, Inscricao>;
  all: Inscricao[];
  issues: SheetIssue[];
}
