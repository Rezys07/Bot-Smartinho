import type { Messages } from "./pt";

const pad3 = (n: number) => String(n).padStart(3, "0");

export const en: Messages = {
  locale: "en-US",
  hackathon: "Women in STEM Hackathon",

  teamName: (n) => `team-${pad3(n)}`,
  teamLabel: (n) => `Team ${pad3(n)}`,
  categoryName: (start, end, voice) => `TEAMS-${pad3(start)}-TO-${pad3(end)}${voice ? "-VOICE" : ""}`,
  defaultNickname: "Participant",
  defaults: {
    participante: "Participant",
    mentor: "Mentor",
    organizacao: "Organization",
    checkin: "check-in",
    filaMentoria: "mentoring-queue",
    botLogs: "bot-logs",
    salaMentores: "mentors-lounge",
  },

  somethingWrong: "Something went wrong. The organizers have been notified.",
  staffOnly: "this command is for organizers only.",

  help: {
    title: "📋 Bot commands",
    checkin: (channelId) => `**Check-in**\nIn <#${channelId}>, click **✅ Check in** (or \`!join your-email@example.com\`).`,
    team: [
      "**In your team channel**",
      "`!challenge` — see the list of challenges",
      "`!challenge <number>` — choose your team's challenge",
      "`!mentoring <what you need>` — ask a mentor for help (or the 🙋 **Ask for mentoring** button)",
      "`!mentoring @mentor <description>` — ask a specific mentor",
    ].join("\n"),
    mentor: (filaId) =>
      [
        "**Mentoring** (Mentor role)",
        `Requests arrive in ${filaId ? `<#${filaId}>` : "#mentoring-queue"}: click **Take it** and, when done, **Finish mentoring**.`,
      ].join("\n"),
    admin: [
      "**Organizers**",
      "`!create-teams` — re-reads the sheet and creates any missing team channels",
      "Unanswered mentoring requests and everything the bot does show up in #bot-logs.",
    ].join("\n"),
    other: "`!help` — shows this list",
  },

  checkin: {
    button: "Check in",
    modalTitle: "Hackathon check-in",
    emailLabel: "Email used to register",
    emailHint: "Only the bot sees this email. It is not shown in the channel.",
    onlyCommandHere: (chatId) =>
      `check-in is done only with the **Check in** button on the pinned message. ${chatId ? `To chat, please use <#${chatId}>.` : "To chat, please use the chat channel."}`,
    useChannel: (channelId) => `please check in at <#${channelId}>.`,
    usage: "click the **✅ Check in** button on the pinned message, or use `!join your-email@example.com`.",
    invalidEmail: (left) => `That doesn't look like an email. Please check and try again. Attempts left: ${left}.`,
    notFound: (left) =>
      "I couldn't find this email in the registration list. Make sure it is exactly the email you registered with. " +
      `If the problem persists, contact the organizers. Attempts left: ${left}.`,
    usernameNotFound: (username) =>
      `I couldn't find your Discord username (**${username}**) in the registration list. Please contact the organizers to check your registration.`,
    rateLimited: (min) => `Too many attempts. Try again in ${min} min or contact the organizers.`,
    sheetUnavailable: "The registration list is unavailable right now. Please try again in a few minutes.",
    staffNoCheckin: "You are part of the staff (Mentor/Organization), so you don't need to check in. You can already see every team channel.",
    taken: "This registration has already been used by another Discord account. The organizers have been notified and will contact you.",
    noTeam: "no team yet (please contact the organizers)",
    ok: (team) => `✅ Check-in confirmed! Your team: ${team}`,
    already: (team) => `You have already checked in. Your team: ${team}`,
    receiptTitle: "✅ Check-in confirmed — Women in STEM Hackathon",
    receiptTeam: (team, label) => `Your team: **${team}**${label ? ` (${label})` : ""}`,
    receiptChannel: (id) => `Team channel: <#${id}>`,
    receiptCommands: [
      "**Commands** (in your team channel)",
      "`!challenge` — see and choose your challenge",
      "`!mentoring <what you need>` — ask a mentor for help",
    ],
    receiptBye: "Good luck and enjoy the Hackathon! 💡🏆",
  },

  team: {
    topic: (label, sheetLabel, desafio) =>
      [label, sheetLabel ? `Registered as: ${sheetLabel}` : null, `Challenge: ${desafio ?? "not chosen yet (use !challenge)"}`]
        .filter(Boolean)
        .join(" · "),
    welcomeTitle: (name) => `Welcome to ${name}!`,
    welcomeBody: (sheetLabel) =>
      [
        sheetLabel ? `Registered team: **${sheetLabel}**` : null,
        "This channel and the voice channel with the same name are private to your team (mentors and organizers can also see them).",
        "",
        "**Commands**",
        "`!challenge` — list the challenges; `!challenge <option>` chooses your team's challenge",
        "`!mentoring <what you need>` — ask a mentor for help (or use the button below)",
        "`!mentoring @mentor <description>` — ask a specific mentor",
      ]
        .filter((l) => l !== null)
        .join("\n"),
    joined: (userId) => `👋 <@${userId}> joined the team!`,
  },

  desafio: {
    title: "Challenges",
    footer: (deadline) => "Choose with !challenge <number>." + (deadline ? ` Changes allowed until ${deadline}.` : ""),
    useTeamChannel: "please use `!challenge` in your team's text channel.",
    membersOnly: "only team members can choose the challenge.",
    unknown: "I didn't recognize that option. Here is the list:",
    same: (nome) => `Your team is already on the **${nome}** challenge.`,
    deadlinePassed: (when) => `The deadline to change challenges ended on ${when}. Contact the organizers if you need help.`,
    changed: (from, to) => `🔄 Challenge changed from **${from}** to **${to}**.`,
    chosen: (nome) => `🎯 Challenge chosen: **${nome}**. Good work!`,
  },

  mentoria: {
    button: "Ask for mentoring",
    requested: "Mentoring requested. Please wait for a mentor to contact you.",
    useTeamChannel: "Please ask for mentoring in your team's text channel.",
    membersOnly: "Only team members can ask for mentoring here.",
    active: (id, mentorId) =>
      `Your team already has a mentoring request (#${id}) that ${mentorId ? `is being handled by <@${mentorId}>` : "is waiting for a mentor"}. Please wait until it is finished.`,
    notMentor: "the person you mentioned does not have the Mentor role.",
    chooseTopic: "Choose the mentoring topic (next you will describe what you need):",
    chooseTopicShort: "Choose the mentoring topic:",
    selectPlaceholder: "What do you need help with?",
    onlyRequester: "Only the person who asked can choose the topic. Use `!mentoring` to make your own request.",
    modalTitle: (topic) => `Mentoring: ${topic}`,
    modalLabel: "What do you need?",
    modalHint: "Describe your question or where you are stuck.",
    modalPlaceholder: "E.g.: we want to validate whether the problem we chose matters to our users",
    tooShort: "Please describe what you need in a bit more detail.",
    alreadyOpen: (id) => `Your team already has an open request (#${id}).`,
    otherTopic: { nome: "Other topic", descricao: "Describe what you need" },
    queueTitle: (id, team) => `🙋 Mentoring #${id} — ${team}`,
    fTeam: "Team",
    fChallenge: "Challenge",
    fTopic: "Topic",
    fAt: "Requested at",
    fNeeds: "What they need",
    fStatus: "Status",
    fRequested: "Requested mentor",
    fSession: "Session",
    noChallenge: "not chosen",
    status: {
      aberta: "⏳ Waiting for a mentor",
      em_atendimento: (mentorId) => `🧑‍🏫 In progress with <@${mentorId}>`,
      finalizada: "✅ Finished",
      cancelada: "✖️ Cancelled by the team",
    },
    attend: "Take it",
    finish: "Finish mentoring",
    pingFor: (mentions) => `${mentions} a request for you:`,
    onlyMentors: "Only mentors can take requests.",
    alreadyClaimed: (mentorId) => `This request is already being handled by <@${mentorId}>.`,
    notOpen: "This request is no longer open.",
    teamClaimed: (mentorId, voiceId) =>
      `🧑‍🏫 <@${mentorId}> will help you with your mentoring request!${voiceId ? ` If you prefer to talk, join <#${voiceId}>.` : ""}`,
    mentorClaimed: (team, textId, voiceId) =>
      `You are mentoring **${team}**: ${textId ? `<#${textId}>` : ""}${voiceId ? ` · voice <#${voiceId}>` : ""}.\nWhen you are done, click **Finish mentoring** in the queue.`,
    onlyOwner: (mentorId) => `Only <@${mentorId}> (the mentor handling it) or an organizer can finish it.`,
    notInProgress: "This request is not in progress.",
    teamFinished: (minutes) =>
      `✅ Mentoring finished (${minutes} min). If you need help again, use \`!mentoring\` or the 🙋 **Ask for mentoring** button.`,
  },

  staff: {
    mentor: (member, fila) =>
      [
        `🎉 **Congratulations, ${member}! Welcome to the Women in STEM Hackathon mentor team!**`,
        "",
        "You have received the **Mentor** role and can now see every team's text and voice channels.",
        "",
        "**How mentoring works**",
        `• Team requests arrive in ${fila}, with a topic and a description.`,
        "• Click **Take it** to pick up a request — the team is notified right away.",
        "• When you are done, click **Finish mentoring**.",
        "• If a team asks for you by name, you will be mentioned in the queue.",
        "",
        "Thank you for being part of this! 💡🏆",
      ].join("\n"),
    organizacao: (member, fila, logs) =>
      [
        `🎉 **Congratulations, ${member}! Welcome to the Women in STEM Hackathon organizing team!**`,
        "",
        "You have received the **Organization** role and can see every team channel, the mentoring queue and the bot logs.",
        "",
        `• ${logs}: everything the bot does (check-ins, teams, mentoring, alerts).`,
        `• ${fila}: mentoring requests from the teams.`,
        "• Organizer commands (`!status`, `!teams`, `!move`, `!sync`…) work in any channel.",
        "",
        "Have a great event! 🚀",
      ].join("\n"),
  },
};
