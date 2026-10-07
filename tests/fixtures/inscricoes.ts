/**
 * Planilha FICTÍCIA com a mesma estrutura da real (Nome, E-mail, Equipe).
 * Nomes e e-mails são inventados.
 */
export const HEADER = ["Nome", "E-mail", "Equipe"];

export function buildFixture(): string[][] {
  return [
    HEADER,
    ["Ana Beatriz Lima", "pessoa1@exemplo.test", "Equipe 07"], // linha 2
    ["Bruno Henrique Costa", " PESSOA2@Exemplo.Test ", "7"], // mesma equipe, grafia diferente
    ["Caio Dias", "pessoa3@exemplo.test", "equipe-07"],
    ["Daniela Souza", "pessoa4@exemplo.test", ""], // individual
    ["Érica Fernandes-Melo", "pessoa5@exemplo.test", "Os Urbanistas"],
    ["Felipe Rocha", "pessoa6@exemplo.test", "os urbanistas "],
    ["Gustavo Nunes", "pessoa7@exemplo.test", "Sem equipe"], // individual
    ["Daniela Souza", "pessoa4@exemplo.test", ""], // linha 9: duplicada
    ["Sem Email", "nao-e-email", ""], // linha 10: inválida
    ["", "", ""], // vazia
    ["Helena Prado", "pessoa8@exemplo.test", "Grandona"],
    ["Igor Santana", "pessoa9@exemplo.test", "Grandona"],
    ["Júlia Moreira", "pessoa10@exemplo.test", "Grandona"],
  ];
}
