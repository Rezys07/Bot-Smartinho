const pad3 = (n: number) => String(n).padStart(3, "0");

/** Textos que os participantes, mentores e organização veem. O #bot-logs fica sempre em português. */
export const pt = {
  locale: "pt-BR",
  hackathon: "Hackathon Cidades Inteligentes",

  // Nomes no servidor
  teamName: (n: number) => `equipe-${pad3(n)}`,
  teamLabel: (n: number) => `Equipe ${pad3(n)}`,
  categoryName: (start: number, end: number, voice: boolean) => `EQUIPES-${pad3(start)}-A-${pad3(end)}${voice ? "-VOZ" : ""}`,
  defaultNickname: "Participante",
  defaults: {
    participante: "Convidado",
    mentor: "Mentor",
    organizacao: "Organização",
    checkin: "check-in",
    filaMentoria: "fila-mentoria",
    botLogs: "bot-logs",
    salaMentores: "sala-dos-mentores",
  },

  // Genéricos
  somethingWrong: "Algo deu errado. A organização foi avisada.",
  staffOnly: "este comando é só para a organização.",
  mentorsAndStaffOnly: "este comando é só para mentores e organização.",

  // !help
  help: {
    title: "📋 Comandos do bot",
    checkin: (channelId: string) =>
      `**Check-in**\nNo <#${channelId}>, clique em **✅ Fazer check-in** (ou \`!entrar seu-email@exemplo.com\`).`,
    team: [
      "**No canal da sua equipe**",
      "`!desafio` — ver a lista de desafios",
      "`!desafio <número>` — escolher o desafio da equipe",
      "`!queromentoria <o que vocês precisam>` — pedir ajuda a um mentor (ou o botão 🙋 **Pedir mentoria**)",
      "`!queromentoria @mentor <descrição>` — pedir um mentor específico",
    ].join("\n"),
    mentor: (filaId: string | null) =>
      [
        "**Mentoria** (cargo Mentor)",
        `Os pedidos chegam em ${filaId ? `<#${filaId}>` : "#fila-mentoria"}: clique em **Atender** e, ao terminar, em **Finalizar mentoria**.`,
        "`!mover @pessoa equipe-004` — troca a equipe de quem já fez check-in",
      ].join("\n"),
    admin: [
      "**Organização**",
      "`!criar-equipes` — relê a planilha e cria os canais das equipes que faltam",
      "Pedidos de mentoria sem atendimento e tudo o que o bot faz aparecem no #bot-logs.",
    ].join("\n"),
    other: "`!help` / `!ajuda` — mostra esta lista",
  },

  // Check-in
  checkin: {
    button: "Fazer check-in",
    modalTitle: "Check-in do Hackathon",
    emailLabel: "E-mail usado na inscrição",
    emailHint: "Só o bot vê este e-mail. Ele não aparece no canal.",
    onlyCommandHere: (chatId: string | null) =>
      `o check-in é só pelo botão **Fazer check-in** da mensagem fixada. ${chatId ? `Para conversar, use <#${chatId}>.` : "Para conversar, use o canal de bate-papo."}`,
    useChannel: (channelId: string) => `faça o check-in no canal <#${channelId}>.`,
    usage: "clique no botão **✅ Fazer check-in** da mensagem fixada, ou use `!entrar seu-email@exemplo.com`.",
    invalidEmail: (left: number) => `Isso não parece um e-mail. Confira e tente de novo. Tentativas restantes: ${left}.`,
    notFound: (left: number) =>
      "Não encontrei esse e-mail na lista de inscritos. Confira se é exatamente o e-mail usado na inscrição. " +
      `Se o problema continuar, fale com a organização. Tentativas restantes: ${left}.`,
    usernameNotFound: (username: string) =>
      `Não encontrei seu usuário do Discord (**${username}**) na lista de inscritos. Fale com a organização para conferir sua inscrição.`,
    rateLimited: (min: number) => `Muitas tentativas. Tente de novo em ${min} min ou procure a organização.`,
    sheetUnavailable: "A lista de inscritos está indisponível agora. Tente de novo em alguns minutos.",
    staffNoCheckin: "Você faz parte da staff (Mentor/Organização) e não precisa fazer check-in. Você já vê os canais das equipes.",
    taken: "Essa inscrição já foi usada por outra conta do Discord. A organização foi avisada e vai falar com você.",
    noTeam: "nenhuma equipe ainda (fale com a organização)",
    ok: (team: string) => `✅ Check-in confirmado! Sua equipe: ${team}`,
    already: (team: string) => `Você já fez check-in. Sua equipe: ${team}`,
    receiptTitle: "✅ Check-in confirmado — Hackathon Cidades Inteligentes",
    receiptTeam: (team: string, label: string | null) => `Sua equipe: **${team}**${label ? ` (${label})` : ""}`,
    receiptChannel: (id: string) => `Canal da equipe: <#${id}>`,
    receiptCommands: [
      "**Comandos** (no canal da equipe)",
      "`!desafio` — ver e escolher o desafio",
      "`!queromentoria <o que vocês precisam>` — pedir ajuda a um mentor",
    ],
    receiptBye: "Boa sorte e bom Hackathon! 💡🏆",
  },

  // Canal da equipe
  team: {
    topic: (label: string, sheetLabel: string | null, desafio: string | null) =>
      [label, sheetLabel ? `Nome na inscrição: ${sheetLabel}` : null, `Desafio: ${desafio ?? "não escolhido (use !desafio)"}`]
        .filter(Boolean)
        .join(" · "),
    welcomeTitle: (name: string) => `Bem-vindos à ${name}!`,
    welcomeBody: (sheetLabel: string | null) =>
      [
        sheetLabel ? `Equipe da inscrição: **${sheetLabel}**` : null,
        "Este canal e o canal de voz com o mesmo nome são privados da equipe (mentores e organização também têm acesso).",
        "",
        "**Comandos**",
        "`!desafio` — lista os desafios; `!desafio <opção>` escolhe o da equipe",
        "`!queromentoria <o que vocês precisam>` — pede ajuda a um mentor (ou use o botão abaixo)",
        "`!queromentoria @mentor <descrição>` — pede um mentor específico",
      ]
        .filter((l) => l !== null)
        .join("\n"),
    joined: (userId: string) => `👋 <@${userId}> entrou na equipe!`,
  },

  // Desafios
  desafio: {
    title: "Desafios",
    footer: (deadline: string | null) => "Escolha com !desafio <número>." + (deadline ? ` Trocas permitidas até ${deadline}.` : ""),
    useTeamChannel: "use `!desafio` no canal de texto da sua equipe.",
    membersOnly: "só membros da equipe podem escolher o desafio.",
    unknown: "Não reconheci essa opção. Veja a lista:",
    same: (nome: string) => `A equipe já está no desafio **${nome}**.`,
    deadlinePassed: (when: string) => `O prazo para trocar de desafio terminou em ${when}. Fale com a organização se precisar.`,
    changed: (from: string, to: string) => `🔄 Desafio alterado de **${from}** para **${to}**.`,
    chosen: (nome: string) => `🎯 Desafio escolhido: **${nome}**. Bom trabalho!`,
  },

  // Mentoria
  mentoria: {
    button: "Pedir mentoria",
    requested: "Mentoria solicitada. Por favor aguarde o contato de um mentor.",
    useTeamChannel: "Peça mentoria no canal de texto da sua equipe.",
    membersOnly: "Só membros da equipe podem pedir mentoria aqui.",
    active: (id: number, mentorId: string | null) =>
      `A equipe já tem uma solicitação de mentoria (#${id}) que ${mentorId ? `está sendo atendida por <@${mentorId}>` : "ainda aguarda um mentor"}. Aguarde terminar para pedir outra.`,
    notMentor: "a pessoa mencionada não tem o cargo Mentor.",
    chooseTopic: "Escolha o tema da mentoria (em seguida vocês descrevem o que precisam):",
    chooseTopicShort: "Escolha o tema da mentoria:",
    selectPlaceholder: "Sobre o que vocês precisam de ajuda?",
    onlyRequester: "Só quem pediu a mentoria pode escolher o tema. Use `!queromentoria` para fazer o seu pedido.",
    modalTitle: (topic: string) => `Mentoria: ${topic}`,
    modalLabel: "O que vocês precisam?",
    modalHint: "Descreva a dúvida ou o ponto em que estão travados.",
    modalPlaceholder: "Ex.: queremos validar se o problema que escolhemos é relevante para a prefeitura",
    tooShort: "Descreva com um pouco mais de detalhe o que vocês precisam.",
    alreadyOpen: (id: number) => `A equipe já tem uma solicitação aberta (#${id}).`,
    otherTopic: { nome: "Outro assunto", descricao: "Descreva o que vocês precisam" },
    // Fila
    queueTitle: (id: number, team: string) => `🙋 Mentoria #${id} — ${team}`,
    fTeam: "Equipe",
    fChallenge: "Desafio",
    fTopic: "Tema",
    fAt: "Pedido às",
    fNeeds: "O que precisam",
    fStatus: "Status",
    fRequested: "Mentor solicitado",
    fSession: "Atendimento",
    noChallenge: "não escolhido",
    status: {
      aberta: "⏳ Aguardando mentor",
      em_atendimento: (mentorId: string) => `🧑‍🏫 Em atendimento com <@${mentorId}>`,
      finalizada: "✅ Finalizada",
      cancelada: "✖️ Cancelada pela equipe",
    },
    attend: "Atender",
    finish: "Finalizar mentoria",
    pingFor: (mentions: string) => `${mentions} pedido para vocês:`,
    onlyMentors: "Só mentores podem atender pedidos.",
    alreadyClaimed: (mentorId: string) => `Este pedido já está sendo atendido por <@${mentorId}>.`,
    notOpen: "Este pedido não está mais aberto.",
    teamClaimed: (mentorId: string, voiceId: string | null) =>
      `🧑‍🏫 <@${mentorId}> vai atender o pedido de mentoria de vocês!${voiceId ? ` Se preferirem conversar, entrem em <#${voiceId}>.` : ""}`,
    mentorClaimed: (team: string, textId: string | null, voiceId: string | null) =>
      `Você está atendendo a **${team}**: ${textId ? `<#${textId}>` : ""}${voiceId ? ` · voz <#${voiceId}>` : ""}.\nQuando terminar, clique em **Finalizar mentoria** na fila.`,
    onlyOwner: (mentorId: string) => `Só <@${mentorId}> (quem está atendendo) ou a organização pode finalizar.`,
    notInProgress: "Este pedido não está em atendimento.",
    teamFinished: (minutes: number) =>
      `✅ Mentoria finalizada (${minutes} min). Se precisarem de novo, usem \`!queromentoria\` ou o botão 🙋 **Pedir mentoria**.`,
  },

  // Boas-vindas da staff (planilha de mentores)
  staff: {
    mentor: (member: string, fila: string) =>
      [
        `🎉 **Parabéns, ${member}! Boas-vindas à equipe de mentores do Hackathon Cidades Inteligentes!**`,
        "",
        "Você recebeu o cargo **Mentor** e já tem acesso aos canais de texto e de voz de todas as equipes.",
        "",
        "**Como funciona a mentoria**",
        `• Os pedidos das equipes chegam em ${fila}, com tema e descrição.`,
        "• Clique em **Atender** para assumir um pedido — a equipe é avisada na hora.",
        "• Ao terminar, clique em **Finalizar mentoria**.",
        "• Se uma equipe pedir você pelo nome, você será mencionado(a) na fila.",
        "",
        "Obrigado por fazer parte! 💡🏆",
      ].join("\n"),
    organizacao: (member: string, fila: string, logs: string) =>
      [
        `🎉 **Parabéns, ${member}! Boas-vindas à Organização do Hackathon Cidades Inteligentes!**`,
        "",
        "Você recebeu o cargo **Organização** e tem acesso a todos os canais das equipes, à fila de mentoria e aos registros do bot.",
        "",
        `• ${logs}: tudo o que o bot faz (check-ins, equipes, mentorias, alertas).`,
        `• ${fila}: pedidos de mentoria das equipes.`,
        "• Comandos de organização (`!status`, `!equipes`, `!mover`, `!sync`…) funcionam em qualquer canal.",
        "",
        "Bom evento! 🚀",
      ].join("\n"),
  },
};

export type Messages = typeof pt;
