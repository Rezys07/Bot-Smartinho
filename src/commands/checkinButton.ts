import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Messages } from "../i18n";
import { canCheckinByUsername, runCheckin, runCheckinByUsername } from "./entrar";
import { registerButton, registerModal } from "./interactions";

export const CHECKIN_BUTTON_ID = "checkin:abrir";
const MODAL_ID = "checkin:enviar";
const EMAIL_FIELD = "email";

/** Botão exibido na mensagem fixada do #check-in. */
export function checkinButtonRow(t: Messages) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CHECKIN_BUTTON_ID).setLabel(t.checkin.button).setEmoji("✅").setStyle(ButtonStyle.Success),
  );
}

/**
 * Clique no botão:
 * 1) se o usuário do Discord está na planilha (ou já fez check-in) → check-in na hora, sem digitar nada;
 * 2) senão, se a planilha tem e-mail → abre a janela pedindo o e-mail;
 * 3) senão → avisa que o usuário não está na lista.
 */
registerButton(CHECKIN_BUTTON_ID, async (ctx, i) => {
  const username = i.user.username;
  const sheetHasEmail = ctx.store.snapshot?.sheet.hasEmailColumn ?? true;

  if (canCheckinByUsername(ctx, i.user.id, username) || !sheetHasEmail) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const r = await runCheckinByUsername(ctx, i.user.id, username, "botão (usuário)");
    await i.editReply({ content: r.text });
    return;
  }

  const c = ctx.t.checkin;
  await i.showModal(
    new ModalBuilder()
      .setCustomId(MODAL_ID)
      .setTitle(c.modalTitle)
      .addLabelComponents(
        new LabelBuilder()
          .setLabel(c.emailLabel)
          .setDescription(c.emailHint)
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId(EMAIL_FIELD)
              .setStyle(TextInputStyle.Short)
              .setPlaceholder("email@example.com")
              .setRequired(true)
              .setMinLength(5)
              .setMaxLength(254),
          ),
      ),
  );
});

// Envio da janela → check-in por e-mail, com resposta visível só para a pessoa.
registerModal(MODAL_ID, async (ctx, i) => {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const r = await runCheckin(ctx, i.user.id, i.fields.getTextInputValue(EMAIL_FIELD), "botão");
  await i.editReply({ content: r.text });
});
