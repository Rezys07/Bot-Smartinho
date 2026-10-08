import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  type Message,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits as P,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type TextChannel,
  type VoiceChannel,
} from "discord.js";
import { isMentor, isOrganizacao, type BotContext } from "../bot/context";
import { describeDiscordError, sendTemp } from "../bot/messaging";
import { registerCommand } from "../commands/router";
import { registerButton, registerModal, registerSelect } from "../commands/interactions";
import type { TeamRow } from "../db/repo";
import { logger } from "../logger";
import { teamName } from "../teams/naming";
import type { MentoringRequest } from "./requests";
import { OTHER_TOPIC, resolveMentorRefs, type Topic } from "./topics";

const DESCRIPTION_MIN = 10;
const DESCRIPTION_MAX = 1000;
const PENDING_TTL_MS = 10 * 60_000;

/** Texto exigido na especificação após o pedido. */
export const REQUESTED_TEXT = "Mentoria solicitada. Por favor aguarde o contato de um mentor.";

// ── Botão "Pedir mentoria" (mensagem de boas-vindas da equipe) ─────────────

export function mentoriaButtonRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("mentoria:pedir").setLabel("Pedir mentoria").setEmoji("🙋").setStyle(ButtonStyle.Primary),
  );
}

// ── Estado entre os passos (comando → tema → descrição) ─────────────────────

interface Pending {
  description: string;
  mentorId: string | null;
  expires: number;
}
const pending = new Map<string, Pending>();
const pendingKey = (userId: string, channelId: string) => `${userId}:${channelId}`;

function takePending(userId: string, channelId: string): Pending | null {
  const key = pendingKey(userId, channelId);
  const p = pending.get(key);
  if (!p || p.expires < Date.now()) {
    pending.delete(key);
    return null;
  }
  return p;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Valida canal de equipe + permissão. Retorna a equipe ou uma mensagem de erro. */
function teamForRequest(ctx: BotContext, channelId: string, userId: string, member: Parameters<typeof isOrganizacao>[1]):
  | { team: TeamRow }
  | { error: string } {
  const team = ctx.repo.teamByChannel(channelId);
  if (!team || team.text_channel_id !== channelId) return { error: "Peça mentoria no canal de texto da sua equipe." };
  const participant = ctx.repo.participant(userId);
  if (participant?.team_number !== team.number && !isOrganizacao(ctx, member)) {
    return { error: "Só membros da equipe podem pedir mentoria aqui." };
  }
  const active = ctx.mentoring.activeForTeam(team.number);
  if (active) {
    const who = active.mentor_id ? `está sendo atendida por <@${active.mentor_id}>` : "ainda aguarda um mentor";
    return { error: `A equipe já tem uma solicitação de mentoria (#${active.id}) que ${who}. Aguarde terminar para pedir outra.` };
  }
  return { team };
}

function topicSelect(ctx: BotContext, userId: string) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`mentoria:tema:${userId}`)
      .setPlaceholder("Sobre o que vocês precisam de ajuda?")
      .addOptions(
        ctx.topics.map((t) => ({
          label: t.nome,
          value: t.id,
          description: t.descricao || undefined,
        })),
      ),
  );
}

function mentorCandidates(ctx: BotContext) {
  return ctx.roles.mentor.members.map((m) => ({
    id: m.id,
    names: [m.displayName, m.user.globalName ?? "", m.user.username].filter(Boolean),
  }));
}

export function topicMentorIds(ctx: BotContext, topic: Topic) {
  return resolveMentorRefs(topic.mentores, mentorCandidates(ctx));
}

const desafioNome = (ctx: BotContext, team: TeamRow) =>
  team.desafio ? (ctx.desafios.find((d) => d.id === team.desafio)?.nome ?? team.desafio) : "não escolhido";

const ts = (iso: string | null) => (iso ? `<t:${Math.floor(Date.parse(iso) / 1000)}:t>` : "—");

function queueEmbed(ctx: BotContext, req: MentoringRequest, team: TeamRow) {
  const topic = ctx.topics.find((t) => t.id === req.topic) ?? OTHER_TOPIC;
  const status = {
    aberta: { label: "⏳ Aguardando mentor", color: 0xf08c00 },
    em_atendimento: { label: `🧑‍🏫 Em atendimento com <@${req.mentor_id}>`, color: 0x1971c2 },
    finalizada: { label: "✅ Finalizada", color: 0x868e96 },
    cancelada: { label: "✖️ Cancelada pela equipe", color: 0x868e96 },
  }[req.status];
  const e = new EmbedBuilder()
    .setTitle(`🙋 Mentoria #${req.id} — ${teamName(team.number)}`)
    .setColor(status.color)
    .addFields(
      { name: "Equipe", value: `${teamName(team.number)}${team.sheet_label ? ` (${team.sheet_label})` : ""} · <#${team.text_channel_id}>`, inline: false },
      { name: "Desafio", value: desafioNome(ctx, team), inline: true },
      { name: "Tema", value: topic.nome, inline: true },
      { name: "Pedido às", value: ts(req.created_at), inline: true },
      { name: "O que precisam", value: req.description.slice(0, 1024) },
      { name: "Status", value: status.label },
    );
  if (req.requested_mentor_id) e.addFields({ name: "Mentor solicitado", value: `<@${req.requested_mentor_id}>`, inline: true });
  if (req.claimed_at) e.addFields({ name: "Atendimento", value: `${ts(req.claimed_at)}${req.finished_at ? ` → ${ts(req.finished_at)}` : ""}`, inline: true });
  return e;
}

function queueButtons(req: MentoringRequest) {
  if (req.status === "aberta") {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`mentoria:atender:${req.id}`).setLabel("Atender").setEmoji("🧑‍🏫").setStyle(ButtonStyle.Success),
      ),
    ];
  }
  if (req.status === "em_atendimento") {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`mentoria:finalizar:${req.id}`).setLabel("Finalizar mentoria").setEmoji("✅").setStyle(ButtonStyle.Secondary),
      ),
    ];
  }
  return [];
}

/** Atualiza a mensagem da fila para refletir o estado atual. */
async function refreshQueueMessage(ctx: BotContext, req: MentoringRequest) {
  const fila = ctx.channels.filaMentoria;
  const team = ctx.repo.team(req.team_number);
  if (!fila || !req.queue_message_id || !team) return;
  const msg = await fila.messages.fetch(req.queue_message_id).catch(() => null);
  await msg?.edit({ embeds: [queueEmbed(ctx, req, team)], components: queueButtons(req) }).catch((err) => {
    logger.warn({ id: req.id, err: describeDiscordError(err) }, "falha ao atualizar mensagem da fila");
  });
}

async function teamChannel(ctx: BotContext, team: TeamRow): Promise<TextChannel | null> {
  if (!team.text_channel_id) return null;
  return ((await ctx.guild.channels.fetch(team.text_channel_id).catch(() => null)) as TextChannel | null) ?? null;
}

// ── Passo 1: comando ou botão → escolher tema ──────────────────────────────

/** `!queromentoria [@mentor] [descrição]` */
async function queroMentoria(ctx: BotContext, msg: Message<true>, rest: string) {
  const check = teamForRequest(ctx, msg.channelId, msg.author.id, msg.member);
  if ("error" in check) {
    await sendTemp(msg.channel, `<@${msg.author.id}> ${check.error}`, { mention: msg.author.id, seconds: 30 });
    return;
  }

  let mentorId: string | null = null;
  let description = rest;
  const mention = rest.match(/^<@!?(\d+)>\s*/);
  if (mention) {
    const member = await ctx.guild.members.fetch(mention[1]!).catch(() => null);
    if (!member || !isMentor(ctx, member)) {
      await sendTemp(msg.channel, `<@${msg.author.id}> a pessoa mencionada não tem o cargo Mentor.`, { mention: msg.author.id });
      return;
    }
    mentorId = member.id;
    description = rest.slice(mention[0].length);
  }

  pending.set(pendingKey(msg.author.id, msg.channelId), { description: description.trim(), mentorId, expires: Date.now() + PENDING_TTL_MS });
  await msg.reply({
    content: "Escolha o tema da mentoria (em seguida vocês descrevem o que precisam):",
    components: [topicSelect(ctx, msg.author.id)],
    allowedMentions: { repliedUser: false },
  });
}

registerCommand(["queromentoria", "quero-mentoria", "mentoria"], { run: (ctx, msg, _a, rest) => queroMentoria(ctx, msg, rest) });

registerButton("mentoria:pedir", async (ctx, i) => {
  const check = teamForRequest(ctx, i.channelId, i.user.id, i.member);
  if ("error" in check) {
    await i.reply({ content: check.error, flags: MessageFlags.Ephemeral });
    return;
  }
  pending.set(pendingKey(i.user.id, i.channelId), { description: "", mentorId: null, expires: Date.now() + PENDING_TTL_MS });
  await i.reply({ content: "Escolha o tema da mentoria:", components: [topicSelect(ctx, i.user.id)], flags: MessageFlags.Ephemeral });
});

// ── Passo 2: tema escolhido → janela com a descrição ────────────────────────

registerSelect("mentoria:tema", async (ctx, i, ownerId) => {
  if (i.user.id !== ownerId) {
    await i.reply({ content: "Só quem pediu a mentoria pode escolher o tema. Use `!queromentoria` para fazer o seu pedido.", flags: MessageFlags.Ephemeral });
    return;
  }
  const topic = ctx.topics.find((t) => t.id === i.values[0]) ?? OTHER_TOPIC;
  const p = takePending(i.user.id, i.channelId);
  const input = new TextInputBuilder()
    .setCustomId("descricao")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(DESCRIPTION_MIN)
    .setMaxLength(DESCRIPTION_MAX)
    .setPlaceholder("Ex.: queremos validar se o problema que escolhemos é relevante para a prefeitura");
  if (p?.description) input.setValue(p.description.slice(0, DESCRIPTION_MAX));

  await i.showModal(
    new ModalBuilder()
      .setCustomId(`mentoria:enviar:${topic.id}`)
      .setTitle(`Mentoria: ${topic.nome}`.slice(0, 45))
      .addLabelComponents(
        new LabelBuilder()
          .setLabel("O que vocês precisam?")
          .setDescription("Descreva a dúvida ou o ponto em que estão travados.")
          .setTextInputComponent(input),
      ),
  );
  // Limpa o seletor público do !queromentoria para não ficar no canal.
  if (!i.message.flags.has(MessageFlags.Ephemeral)) await i.message.delete().catch(() => undefined);
});

// ── Passo 3: descrição enviada → cria a solicitação e publica na fila ──────

registerModal("mentoria:enviar", async (ctx, i, topicId) => {
  const check = teamForRequest(ctx, i.channelId ?? "", i.user.id, i.member);
  if ("error" in check) {
    await i.reply({ content: check.error, flags: MessageFlags.Ephemeral });
    return;
  }
  const team = check.team;
  const description = i.fields.getTextInputValue("descricao").trim();
  if (description.length < DESCRIPTION_MIN) {
    await i.reply({ content: "Descreva com um pouco mais de detalhe o que vocês precisam.", flags: MessageFlags.Ephemeral });
    return;
  }
  const topic = ctx.topics.find((t) => t.id === topicId) ?? OTHER_TOPIC;
  const p = takePending(i.user.id, i.channelId ?? "");
  pending.delete(pendingKey(i.user.id, i.channelId ?? ""));

  const created = ctx.mentoring.create({
    teamNumber: team.number,
    topic: topic.id,
    description,
    requestedBy: i.user.id,
    requestedMentorId: p?.mentorId ?? null,
  });
  if (!created.ok) {
    await i.reply({ content: `A equipe já tem uma solicitação aberta (#${created.active.id}).`, flags: MessageFlags.Ephemeral });
    return;
  }
  const req = created.request;
  await i.reply({ content: `🙋 ${REQUESTED_TEXT}\n> **${topic.nome}** — ${description.slice(0, 300)}` });

  // Quem avisar: o mentor pedido por menção + os mentores sugeridos para o tema.
  const notify = new Set<string>();
  if (req.requested_mentor_id) notify.add(req.requested_mentor_id);
  for (const id of topicMentorIds(ctx, topic).ids) notify.add(id);

  const fila = ctx.channels.filaMentoria;
  if (!fila) {
    await ctx.audit(`❗ Mentoria #${req.id} de ${teamName(team.number)} registrada, mas o canal #fila-mentoria não existe. Rode \`bun run setup\`.`);
    return;
  }
  try {
    const msg = await fila.send({
      content: notify.size ? `${[...notify].map((id) => `<@${id}>`).join(" ")} pedido para vocês:` : undefined,
      embeds: [queueEmbed(ctx, req, team)],
      components: queueButtons(req),
      allowedMentions: { users: [...notify] },
    });
    ctx.mentoring.setQueueMessage(req.id, msg.id);
  } catch (err) {
    await ctx.audit(`❗ Não consegui publicar a mentoria #${req.id} na fila: ${describeDiscordError(err)}`);
  }
  await ctx.audit(`🙋 Mentoria #${req.id} pedida por <@${i.user.id}> (${teamName(team.number)}), tema "${topic.nome}".`);
});

// ── Atender / Finalizar (botões em #fila-mentoria) ─────────────────────────

registerButton("mentoria:atender", async (ctx, i, arg) => {
  if (!isMentor(ctx, i.member) && !isOrganizacao(ctx, i.member)) {
    await i.reply({ content: "Só mentores podem atender pedidos.", flags: MessageFlags.Ephemeral });
    return;
  }
  const r = ctx.mentoring.claim(Number(arg), i.user.id);
  if (!r.ok) {
    const msg =
      r.reason === "already_claimed"
        ? `Este pedido já está sendo atendido por <@${r.request!.mentor_id}>.`
        : "Este pedido não está mais aberto.";
    await i.reply({ content: msg, flags: MessageFlags.Ephemeral });
    if (r.request) await refreshQueueMessage(ctx, r.request);
    return;
  }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const req = r.request;
  const team = ctx.repo.team(req.team_number)!;
  const text = await teamChannel(ctx, team);
  const voice = team.voice_channel_id
    ? ((await ctx.guild.channels.fetch(team.voice_channel_id).catch(() => null)) as VoiceChannel | null)
    : null;

  // Mentores já veem os canais pelo cargo; acesso temporário só se faltar (ex.: organização atendendo).
  if (text && !text.permissionsFor(i.member).has(P.ViewChannel)) {
    try {
      await ctx.gateway.grantAccess(team, i.user.id);
      ctx.mentoring.setGrantedAccess(req.id);
    } catch (err) {
      await ctx.audit(`❗ Não consegui dar acesso a <@${i.user.id}> na ${teamName(team.number)}: ${describeDiscordError(err)}`);
    }
  }

  await text
    ?.send({
      content: `🧑‍🏫 <@${i.user.id}> vai atender o pedido de mentoria de vocês!${voice ? ` Se preferirem conversar, entrem em <#${voice.id}>.` : ""}`,
      allowedMentions: { users: [i.user.id, req.requested_by] },
    })
    .catch(() => undefined);
  await refreshQueueMessage(ctx, ctx.mentoring.get(req.id)!);
  await i.editReply({
    content: `Você está atendendo a **${teamName(team.number)}**: ${text ? `<#${text.id}>` : ""}${voice ? ` · voz <#${voice.id}>` : ""}.\nQuando terminar, clique em **Finalizar mentoria** na fila.`,
  });
  await ctx.audit(`🧑‍🏫 Mentoria #${req.id} (${teamName(team.number)}) assumida por <@${i.user.id}>.`);
});

registerButton("mentoria:finalizar", async (ctx, i, arg) => {
  const force = isOrganizacao(ctx, i.member);
  const r = ctx.mentoring.finish(Number(arg), i.user.id, force);
  if (!r.ok) {
    const msg =
      r.reason === "not_owner"
        ? `Só <@${r.request!.mentor_id}> (quem está atendendo) ou a organização pode finalizar.`
        : "Este pedido não está em atendimento.";
    await i.reply({ content: msg, flags: MessageFlags.Ephemeral });
    return;
  }
  await i.deferUpdate();
  const req = r.request;
  const team = ctx.repo.team(req.team_number)!;
  if (req.granted_access && req.mentor_id) {
    await ctx.gateway.revokeAccess(team, req.mentor_id).catch((err) =>
      ctx.audit(`❗ Não consegui remover o acesso de <@${req.mentor_id}> da ${teamName(team.number)}: ${describeDiscordError(err)}`),
    );
  }
  await refreshQueueMessage(ctx, req);
  const text = await teamChannel(ctx, team);
  await text
    ?.send({
      content: `✅ Mentoria finalizada (${r.minutes} min). Se precisarem de novo, usem \`!queromentoria\` ou o botão 🙋 **Pedir mentoria**.`,
      allowedMentions: { parse: [] },
    })
    .catch(() => undefined);
  await ctx.audit(
    `✅ Mentoria #${req.id} (${teamName(team.number)}) finalizada por <@${i.user.id}> — duração ${r.minutes} min (mentor <@${req.mentor_id}>).`,
  );
});

// ── Aviso de pedidos sem atendimento ───────────────────────────────────────

export function startMentoringAlerts(ctx: BotContext): () => void {
  const tick = async () => {
    for (const req of ctx.mentoring.overdue(ctx.env.MENTORIA_ALERTA_MINUTOS)) {
      ctx.mentoring.markAlerted(req.id);
      const team = ctx.repo.team(req.team_number);
      const text =
        `⏰ <@&${ctx.roles.organizacao.id}> a mentoria #${req.id} da **${team ? teamName(team.number) : "?"}** está há mais de ` +
        `${ctx.env.MENTORIA_ALERTA_MINUTOS} min sem atendimento.`;
      logger.warn({ id: req.id }, "mentoria sem atendimento");
      await ctx.channels.botLogs
        ?.send({ content: text, allowedMentions: { roles: [ctx.roles.organizacao.id] } })
        .catch((err) => logger.error({ err: describeDiscordError(err) }, "falha ao enviar alerta de mentoria"));
    }
  };
  const timer = setInterval(() => void tick(), 60_000);
  return () => clearInterval(timer);
}
