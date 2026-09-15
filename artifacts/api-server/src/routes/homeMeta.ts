import { existsSync } from "node:fs";
import path from "node:path";
import { Router, type IRouter } from "express";
import { getCommunitySession } from "../admin/communitySession.js";
import { getGuerraFriaMember } from "../admin/permissions.js";
import { discordClient } from "../bot/client.js";

const router: IRouter = Router();
const DISCORD_INVITE_URL = "https://discord.gg/guerrafria";
const DISCORD_INVITE_CODE = "guerrafria";

function resolveBannerPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "artifacts/api-server/public/gf-home-banner-exact.jpg"),
    path.resolve(process.cwd(), "artifacts/api-server/public/gf-home-hero.jpg"),
    path.resolve(process.cwd(), "public/gf-home-banner-exact.jpg"),
    path.resolve(process.cwd(), "public/gf-home-hero.jpg"),
  ];
  return candidates.find(existsSync) ?? null;
}

router.get("/home/banner", (_req, res) => {
  const file = resolveBannerPath();
  if (!file) return void res.status(404).end();
  res.setHeader("Cache-Control", "public, max-age=3600");
  return void res.sendFile(file);
});

router.get("/home/meta", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  let members: number | null = null;
  let guildName = "Guerra Fria";
  const client = discordClient();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  if (client && guildId) {
    const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
    if (guild) {
      members = Number.isFinite(guild.memberCount) ? guild.memberCount : null;
      guildName = guild.name || guildName;
    }
  }
  if (members == null) {
    try {
      const response = await fetch(`https://discord.com/api/v10/invites/${DISCORD_INVITE_CODE}?with_counts=true`);
      if (response.ok) {
        const data = await response.json() as { approximate_member_count?: number; guild?: { name?: string } };
        if (Number.isFinite(data.approximate_member_count)) members = Number(data.approximate_member_count);
        if (data.guild?.name) guildName = data.guild.name;
      }
    } catch {}
  }
  return void res.json({ discord: { inviteUrl: DISCORD_INVITE_URL, members, name: guildName } });
});

router.get("/home/profile", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const session = getCommunitySession(req);
  if (!session) return void res.status(401).json({ authenticated: false });
  const member = await getGuerraFriaMember(session.userId);
  const displayName = member?.displayName?.trim()
    || member?.user.globalName?.trim()
    || member?.user.username?.trim()
    || session.username;
  const avatarUrl = member?.user.displayAvatarURL({ size: 128 }) ?? null;
  return void res.json({ authenticated: true, user: { id: session.userId, username: displayName, avatarUrl }, isAdmin: session.isAdmin });
});

export default router;
