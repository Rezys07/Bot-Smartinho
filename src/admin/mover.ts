import type { GuildMember, Message } from "discord.js";
import type { BotContext } from "../bot/context";
import { describeDiscordError } from "../bot/messaging";
import { registerCommand } from "../commands/router";
import { applyParticipantIdentity } from "../commands/entrar";
import { parseTeamRef } from "../teams/naming";

/** Acha o membro por menção (<@id>), ID ou usuário do Discord. */
async function findMember(ctx: BotContext, msg: Message<true>, ref: string): Promise<GuildMember | null> {
  const mentioned = msg.mentions.members?.first();
  if (mentioned) return mentioned;
  const id = ref.match(/^<@!?(\d+)>$/)?.[1] ?? (/^\d{15,22}$/.test(ref) ? ref : null);
  if (id) return ctx.guild.members.fetch(id).catch(() => null);
  const username = ref.replace(/^@/, "").toLowerCase();
  return ctx.guild.members.cache.find((m) => m.user.username === username) ?? null;
}

/**
 * `!mover @pessoa equipe-004` (ou `!move @person team-004`) — mentores e organização.
 * Troca a equipe de quem já fez check-in: banco, acesso aos canais (sai da antiga, entra na nova) e apelido.
 * Para quem ainda não fez check-in, basta mudar a coluna Equipe na planilha.
 */
async function mover(ctx: BotContext, msg: Message<true>, args: string[]) {
  const reply = (content: string) => msg.reply({ content, allowedMentions: { repliedUser: false, parse: [] } });
  const [who, where] = [args[0] ?? "", args[args.length - 1] ?? ""];
  const number = parseTeamRef(where);
  if (args.length < 2 || number === null) {
    await reply("Use: `!mover @pessoa equipe-004` (aceita também `4` ou o usuário do Discord no lugar da menção).");
    return;
  }

  const member = await findMember(ctx, msg, who);
  if (!member) {
    await reply("Não encontrei essa pessoa no servidor.");
    return;
  }
  const participant = ctx.repo.participant(member.id);
  if (!participant) {
    await reply(`${member} ainda não fez check-in. Mude a coluna **Equipe** dela na planilha: no check-in ela já entra na equipe certa.`);
    return;
  }
  const target = ctx.repo.team(number);
  if (!target) {
    await reply(`A ${ctx.t.teamName(number)} não existe.`);
    return;
  }
  if (participant.team_number === number) {
    await reply(`${member} já está na ${ctx.t.teamName(number)}.`);
    return;
  }

  const old = participant.team_number ? ctx.repo.team(participant.team_number) : null;
  ctx.repo.setParticipantTeam(member.id, number);
  const problems: string[] = [];
  if (old) await ctx.gateway.revokeAccess(old, member.id).catch((err) => problems.push(`acesso antigo: ${describeDiscordError(err)}`));
  try {
    const withChannels = await ctx.gateway.ensureTeamChannels(target);
    await ctx.gateway.grantAccess(withChannels, member.id);
  } catch (err) {
    problems.push(`acesso novo: ${describeDiscordError(err)}`);
  }
  problems.push(...(await applyParticipantIdentity(ctx, member, ctx.repo.participant(member.id)!, target)));

  const size = ctx.repo.teamMembers(number).length;
  const over = size > ctx.env.TEAM_MAX_SIZE ? ` ⚠️ A equipe agora tem ${size} pessoas (limite ${ctx.env.TEAM_MAX_SIZE}).` : "";
  await reply(
    `✅ ${member} movida de **${old ? ctx.t.teamName(old.number) : "nenhuma equipe"}** para **${ctx.t.teamName(number)}**.${over}` +
      (problems.length ? `\n❗ ${problems.join("; ")}` : ""),
  );
  await ctx.audit(
    `🔀 <@${msg.author.id}> moveu <@${member.id}> de **${old ? ctx.t.teamName(old.number) : "—"}** para **${ctx.t.teamName(number)}**.` +
      (problems.length ? ` Problemas: ${problems.join("; ")}` : ""),
  );
}

registerCommand(["mover", "move"], { staffOnly: true, allowMentors: true, run: (ctx, msg, args) => mover(ctx, msg, args) });
