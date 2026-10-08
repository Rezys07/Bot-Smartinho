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
import { runCheckin } from "./entrar";
import { registerButton, registerModal } from "./interactions";

export const CHECKIN_BUTTON_ID = "checkin:abrir";
const MODAL_ID = "checkin:enviar";
const EMAIL_FIELD = "email";

/** Botão exibido na mensagem fixada do #check-in. */
export function checkinButtonRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CHECKIN_BUTTON_ID).setLabel("Fazer check-in").setEmoji("✅").setStyle(ButtonStyle.Success),
  );
}

// Clique no botão → abre a janela pedindo o e-mail.
registerButton(CHECKIN_BUTTON_ID, async (_ctx, i) => {
  const modal = new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle("Check-in do Hackathon")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("E-mail usado na inscrição")
        .setDescription("Só o bot vê este e-mail. Ele não aparece no canal.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(EMAIL_FIELD)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("seu@email.com")
            .setRequired(true)
            .setMinLength(5)
            .setMaxLength(254),
        ),
    );
  await i.showModal(modal);
});

// Envio da janela → check-in com resposta visível só para a pessoa.
registerModal(MODAL_ID, async (ctx, i) => {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const email = i.fields.getTextInputValue(EMAIL_FIELD);
  const r = await runCheckin(ctx, i.user.id, email, "botão");
  await i.editReply({ content: r.text });
});
