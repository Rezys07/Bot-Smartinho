/**
 * Diagnóstico da configuração do bot no Discord (não mostra o token).
 * Uso: bun run discord:check
 */
const token = (process.env.DISCORD_TOKEN ?? "").trim().replace(/^"(.*)"$/, "$1");
const guildId = (process.env.DISCORD_GUILD_ID ?? "").trim().replace(/^"(.*)"$/, "$1");

if (!token) {
  console.error("DISCORD_TOKEN vazio no .env");
  process.exit(1);
}

const api = async (path: string) => {
  const res = await fetch(`https://discord.com/api/v10${path}`, { headers: { Authorization: `Bot ${token}` } });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
};

const app = await api("/applications/@me");
if (app.status === 401) {
  console.error("Token inválido (401). Gere outro em Bot → Reset Token e cole no .env, sem aspas.");
  process.exit(1);
}
const flags = Number(app.body.flags ?? 0);
const has = (bit: number) => (flags & (1 << bit)) !== 0;

console.log(`Aplicação: ${app.body.name} (ID ${app.body.id})`);
console.log(`Bot: ${app.body.bot?.username ?? "?"} (ID ${app.body.bot?.id ?? "?"})`);
console.log("\nIntents privilegiadas:");
console.log(`  Server Members Intent:   ${has(14) || has(15) ? "ATIVA" : "desativada"}`);
console.log(`  Message Content Intent:  ${has(18) || has(19) ? "ATIVA" : "desativada"}`);
console.log(`  Presence Intent:         ${has(12) || has(13) ? "ativa" : "desativada"} (não é necessária)`);

// Permissões que o bot usa (e que ele precisa ter para concedê-las nos canais das equipes).
const PERMISSIONS = "2251800253165136";
console.log(
  `\nLink de convite: https://discord.com/oauth2/authorize?client_id=${app.body.id}&scope=bot&permissions=${PERMISSIONS}` +
    (guildId ? `&guild_id=${guildId}&disable_guild_select=true` : ""),
);

const guilds = await api("/users/@me/guilds");
const list = Array.isArray(guilds.body) ? (guilds.body as { id: string; name: string }[]) : [];
console.log(`\nServidores em que o bot está: ${list.length}`);
for (const g of list) console.log(`  - ${g.name} (ID ${g.id})${g.id === guildId ? "  ← DISCORD_GUILD_ID" : ""}`);

if (guildId) {
  const g = await api(`/guilds/${guildId}`);
  if (g.status === 200) console.log(`\nServidor: ${g.body.name} — o bot está no servidor.`);
  else if (g.status === 403 || g.status === 404) console.log(`\nServidor ${guildId}: o bot NÃO está nesse servidor (ou o ID está errado).`);
  else console.log(`\nServidor: resposta inesperada ${g.status}`);
} else {
  console.log("\nDISCORD_GUILD_ID vazio no .env");
}

export {};
