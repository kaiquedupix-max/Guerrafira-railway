import { PermissionFlagsBits } from "discord.js";
import { discordClient } from "../bot/client.js";

export async function isGuerraFriaAdmin(userId: string): Promise<boolean> {
  const client = discordClient();
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!client || !guildId) return false;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return false;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.Administrator) || Boolean(process.env.ADMIN_ROLE_ID && member.roles.cache.has(process.env.ADMIN_ROLE_ID));
}
