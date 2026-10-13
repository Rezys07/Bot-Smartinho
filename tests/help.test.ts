import { describe, expect, test } from "bun:test";
import type { BotContext } from "../src/bot/context";
import { helpText } from "../src/commands/help";
import { en } from "../src/i18n/en";
import { pt } from "../src/i18n/pt";

const fakeCtx = (t: typeof pt) =>
  ({ t, channels: { checkin: { id: "111" }, filaMentoria: { id: "222" } } }) as unknown as BotContext;

describe("!help", () => {
  test("participante não vê comandos de organização nem de mentoria", () => {
    const text = helpText(fakeCtx(pt), { mentor: false, organizacao: false });
    expect(text).toContain("!desafio");
    expect(text).toContain("<#111>");
    expect(text).not.toContain("!criar-equipes");
    expect(text).not.toContain("Atender");
  });

  test("mentor vê a fila; organização vê tudo", () => {
    expect(helpText(fakeCtx(pt), { mentor: true, organizacao: false })).toContain("<#222>");
    const org = helpText(fakeCtx(pt), { mentor: false, organizacao: true });
    expect(org).toContain("!criar-equipes");
    expect(org).toContain("<#222>");
  });

  test("em inglês", () => {
    const text = helpText(fakeCtx(en), { mentor: false, organizacao: true });
    expect(text).toContain("!challenge");
    expect(text).toContain("!create-teams");
    expect(text).not.toContain("!desafio");
  });
});

describe("!mover no !help", () => {
  test("mentor e organização veem; participante não", () => {
    expect(helpText(fakeCtx(pt), { mentor: false, organizacao: false })).not.toContain("!mover");
    expect(helpText(fakeCtx(pt), { mentor: true, organizacao: false })).toContain("!mover");
    expect(helpText(fakeCtx(en), { mentor: false, organizacao: true })).toContain("!move");
  });
});
