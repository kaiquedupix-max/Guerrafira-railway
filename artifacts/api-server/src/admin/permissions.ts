import { PermissionFlagsBits } from "discord.js";
import { discordClient } from "../bot/client.js";

export async function getGuerraFriaMember(userId: string) {
  const client = discordClient();
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!client || !guildId) return null;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return null;
  return guild.members.fetch(userId).catch(() => null);
}

export async function getGuerraFriaDisplayName(userId: string, fallback = "Administrador"): Promise<string> {
  const member = await getGuerraFriaMember(userId);
  return member?.displayName?.trim() || member?.user.globalName?.trim() || member?.user.username?.trim() || fallback;
}

export async function isGuerraFriaAdmin(userId: string): Promise<boolean> {
  const member = await getGuerraFriaMember(userId);
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.Administrator) || Boolean(process.env.ADMIN_ROLE_ID && member.roles.cache.has(process.env.ADMIN_ROLE_ID));
}
