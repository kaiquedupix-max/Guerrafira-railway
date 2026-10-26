/** Join only the configured community, using the permission granted at login. */
export async function joinGuerraFriaDiscord(userId: string, accessToken: string): Promise<void> {
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!guildId || !botToken) throw new Error("Integração com o servidor Discord não configurada.");
  const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
    method: "PUT",
    headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: accessToken }),
  });
  // 201: joined; 204: already a member. Do not change roles or bypass bans.
  if (response.status === 201 || response.status === 204) return;
  const detail = await response.json().catch(() => ({})) as { code?: number };
  throw new Error(`Não foi possível entrar no Discord do Guerra Fria (HTTP ${response.status}, código ${detail.code ?? "indisponível"}).`);
}
