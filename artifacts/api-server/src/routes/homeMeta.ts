import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Router, type IRouter } from "express";
import { getCommunitySession } from "../admin/communitySession.js";
import { getGuerraFriaMember } from "../admin/permissions.js";
import { discordClient } from "../bot/client.js";

const router: IRouter = Router();
const DISCORD_INVITE_URL = "https://discord.gg/guerrafria";
const DISCORD_INVITE_CODE = "guerrafria";
const FINAL_HERO_CHUNKS = 15;

function resolvePublicPath(...parts: string[]): string | null {
  const candidates = [
    path.resolve(process.cwd(), "artifacts/api-server/public", ...parts),
    path.resolve(process.cwd(), "public", ...parts),
  ];
  return candidates.find(existsSync) ?? null;
}

function resolveBannerPath(): string | null {
  return resolvePublicPath("gf-home-banner-exact.jpg")
    ?? resolvePublicPath("gf-home-hero.jpg")
    ?? resolvePublicPath("guerra-fria-hero.jpeg");
}

function isWebp(data: Buffer): boolean {
  return data.length > 12
    && data.toString("ascii", 0, 4) === "RIFF"
    && data.toString("ascii", 8, 12) === "WEBP";
}

function readChunkedArt(name: "hero" | "store" | "community"): Buffer | null {
  const versions = name === "hero" ? ["art-v7", "art-v2"] : ["art-v2"];
  const roots = [
    path.resolve(process.cwd(), "artifacts/api-server/public"),
    path.resolve(process.cwd(), "public"),
  ];

  for (const version of versions) {
    for (const root of roots) {
      const dir = path.join(root, version);
      if (!existsSync(dir)) continue;

      const files = readdirSync(dir)
        .filter(file => new RegExp(`^${name}-\\d+\\.b64$`).test(file))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      if (!files.length) continue;
      if (name === "hero" && version === "art-v7" && files.length !== FINAL_HERO_CHUNKS) continue;
      if (name === "community" && files.length < 3) continue;

      const encoded = files
        .map(file => readFileSync(path.join(dir, file), "utf8").trim())
        .join("");
      if (!encoded) continue;

      try {
        const decoded = Buffer.from(encoded, "base64");
        if (!isWebp(decoded)) continue;
        if (name === "hero" && version === "art-v7" && decoded.length < 120_000) continue;
        if (decoded.length > 5_000) return decoded;
      } catch {}
    }
  }
  return null;
}

function sendArt(res: any, art: Buffer): void {
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(art);
}

router.get("/home/banner", (_req, res) => {
  const art = readChunkedArt("hero");
  if (art) return void sendArt(res, art);
  const file = resolveBannerPath();
  if (!file) return void res.status(404).end();
  res.setHeader("Cache-Control", "public, max-age=3600");
  return void res.sendFile(file);
});

router.get("/home/art/:name", (req, res) => {
  const requested = String(req.params.name ?? "");
  const name = requested === "store" ? "store" : requested === "community" ? "community" : "hero";
  let art = readChunkedArt(name);
  if (!art && name === "community") art = readChunkedArt("hero");
  if (art) return void sendArt(res, art);
  const fallback = resolveBannerPath();
  if (!fallback) return void res.status(404).end();
  res.setHeader("Cache-Control", "public, max-age=3600");
  return void res.sendFile(fallback);
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
