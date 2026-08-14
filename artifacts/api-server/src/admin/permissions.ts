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

export async function resolveGuerraFriaDisplayNameByStoredName(name: string): Promise<string> {
  const raw = String(name || "").trim();
  if (!raw) return "Administrador";
  const client = discordClient();
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!client || !guildId) return raw;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return raw;
  await guild.members.fetch().catch(() => null);
  const q = raw.toLowerCase();
  const member = guild.members.cache.find(m =>
    m.user.username.toLowerCase() === q ||
    (m.user.globalName || "").toLowerCase() === q ||
    m.displayName.toLowerCase() === q
  );
  return member?.displayName?.trim() || member?.user.globalName?.trim() || raw;
}

export async function isDiscordAdministrator(userId: string): Promise<boolean> {
  const member = await getGuerraFriaMember(userId);
  return Boolean(member?.permissions.has(PermissionFlagsBits.Administrator));
}

export async function isGuerraFriaAdmin(userId: string): Promise<boolean> {
  const member = await getGuerraFriaMember(userId);
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.Administrator) || Boolean(process.env.ADMIN_ROLE_ID && member.roles.cache.has(process.env.ADMIN_ROLE_ID));
}
