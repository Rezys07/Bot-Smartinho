/** Uma linha válida da planilha de inscrições (colunas: Nome, E-mail e/ou usuário do Discord, Equipe). */
export interface Inscricao {
  /** Linha na planilha (1 = cabeçalho), para a organização localizar. */
  row: number;
  /** E-mail normalizado (null se a planilha só tem usuário). */
  email: string | null;
  /** Usuário do Discord normalizado (null se não informado). */
  usuario: string | null;
  nome: string;
  /** Valor da coluna Equipe como foi escrito (null = individual). */
  equipe: string | null;
  /** Chave normalizada da equipe ("Equipe 07" e "7" viram "7"). */
  equipeKey: string | null;
}

export interface SheetIssue {
  kind:
    | "missing_column"
    | "invalid_email"
    | "invalid_username"
    | "missing_identity"
    | "duplicate_email"
    | "duplicate_username"
    | "missing_name"
    | "oversize_team";
  row?: number;
  /** Mensagem sem dados pessoais (sem e-mail). */
  message: string;
}

/** Equipe definida pela organização na planilha. */
export interface DeclaredTeam {
  key: string;
  /** Rótulo como aparece na planilha (primeira ocorrência). */
  label: string;
  members: Inscricao[];
}

export interface ParsedSheet {
  /** Indexado pelo e-mail normalizado; em duplicatas vale a última linha. */
  byEmail: Map<string, Inscricao>;
  /** Indexado pelo usuário do Discord normalizado. */
  byUsername: Map<string, Inscricao>;
  all: Inscricao[];
  teams: Map<string, DeclaredTeam>;
  /** A planilha tem coluna de e-mail? (define se o check-in pode pedir e-mail) */
  hasEmailColumn: boolean;
  issues: SheetIssue[];
}
