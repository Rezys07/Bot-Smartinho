/**
 * Planilha FICTÍCIA com a mesma estrutura do formulário real.
 * Nomes, e-mails e telefones são inventados; os padrões (separadores,
 * autoinclusão, acentos, homônimos) imitam o que aparece em inscrições reais.
 */
export const HEADER = [
  "Carimbo de data/hora",
  "Endereço de e-mail",
  "Nome Completo",
  "Telefone/whatsapp",
  "Instituição de ensino",
  "Qual seu curso?",
  "Áreas de interesse",
  "Como você deseja participar?",
  "Quantos integrantes sua equipe já possui?",
  "Nome dos integrantes da equipe",
  "Motivação",
];

export const MODO1 = "Quero me inscrever individualmente e ser alocado(a) em uma equipe";
export const MODO2 = "Já tenho uma equipe formada";
export const MODO3 = "Já tenho alguns integrantes e gostaria de completar a equipe com outros participantes";

let n = 0;
function row(nome: string, modo: string, integrantes: string, qtd = "", areas = "Mobilidade urbana", email?: string) {
  n++;
  return [
    `01/10/2026 10:${String(n).padStart(2, "0")}:00`,
    email ?? `pessoa${n}@exemplo.test`,
    nome,
    `(00) 90000-00${String(n).padStart(2, "0")}`,
    "Universidade Fictícia",
    "Engenharia",
    areas,
    modo,
    qtd,
    integrantes,
    "Teste",
  ];
}

export function buildFixture(): string[][] {
  n = 0;
  return [
    HEADER,
    // Linhas 2-4: equipe formada, separadores variados, autoinclusão, caixa/acentos diferentes.
    row("Ana Beatriz Lima", MODO2, "Ana Beatriz Lima, Bruno Costa e CAIO DIAS", "3"),
    row("Bruno Henrique Costa", MODO2, "ana beatriz\nCaio Dias", "3"),
    row("Caio Dias", MODO2, "Ana Lima - Bruno Costa - Caio Dias", "3"),
    // Linha 5: individual.
    row("Daniela Souza", MODO1, "Sem equipe", "Sem equipe", "Energia, Mobilidade urbana"),
    // Linhas 6-7: equipe parcial; um nome citado não se inscreveu; hífen inconsistente.
    row("Érica Fernandes-Melo", MODO3, "1. Felipe Rocha\n2. Gustavo Nunes", "2"),
    row("Felipe Rocha", MODO3, "Erica Fernandes Melo", "2"),
    // Linhas 8-9: homônimos de primeiro nome (Marcos) para gerar ambiguidade.
    row("Marcos Vieira", MODO1, "Sem equipe"),
    row("Marcos Teixeira", MODO1, "Sem equipe"),
    // Linha 10: cita "Marcos" (ambíguo) e uma pessoa individual (Daniela Souza).
    row("Helena Prado", MODO2, "Marcos; Daniela Souza", "2"),
    // Linhas 11-12: só o primeiro nome, mas recíproco → agrupa.
    row("Igor Santana", MODO2, "Júlia", "1"),
    row("Júlia Moreira", MODO2, "Igor", "1"),
    // Linha 13: só primeiro nome sem reciprocidade → não agrupa (weak_match).
    row("Karina Alves", MODO2, "Igor", "1"),
    // Linha 14: modo 2 citando alguém do modo 3 (conflito de modo) — Gustavo ainda não se inscreveu.
    row("Lucas Ferraz", MODO2, "Felipe Rocha", "1"),
    // Linha 15: e-mail duplicado (reenvio) → vale esta linha.
    row("Daniela Souza", MODO1, "Sem equipe", "Sem equipe", "Energia", "pessoa4@exemplo.test"),
    // Linha 16: e-mail inválido.
    row("Sem Email", MODO1, "Sem equipe", "", "", "nao-e-email"),
    // Linha 17: equipe grande demais (6 declarados com limite 5).
    row("Otávio Ramos", MODO2, "Paula, Quésia, Rafael, Sérgio, Tânia", "6"),
  ];
}
