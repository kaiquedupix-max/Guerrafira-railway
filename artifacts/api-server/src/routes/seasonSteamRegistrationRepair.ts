import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getCommunitySession } from "../admin/communitySession.js";

const router: IRouter = Router();
const STEAM_COOKIE = "gf_season_steam";

const secret = () => process.env.ADMIN_SESSION_SECRET?.trim() || process.env.DISCORD_CLIENT_SECRET?.trim() || "gf-season-steam";
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

function readSteamCookie(req: any, discordId: string, season: number): string | null {
  const token = String(req.cookies?.[STEAM_COOKIE] || "");
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.discordId !== discordId || Number(data.season) !== season || Number(data.exp) < Date.now()) return null;
    const steamId = String(data.steamId || "");
    return /^7656119\d{10}$/.test(steamId) ? steamId : null;
  } catch {
    return null;
  }
}

router.get("/season/:number/inscricao", async (req, res, next) => {
  const season = Math.max(1, Math.trunc(Number(req.params.number) || 1));
  if (season !== 1) return next();
  const session = getCommunitySession(req);
  if (!session) return next();

  try {
    const steamId = readSteamCookie(req, session.userId, season);
    if (!steamId) return next();

    await db.execute(sql`ALTER TABLE season_registrations ADD COLUMN IF NOT EXISTS steam_id TEXT`);
    const current: any = await db.execute(sql`
      SELECT steam_id,status FROM season_registrations
      WHERE season_number=${season} AND discord_id=${session.userId}
      LIMIT 1
    `);
    const row = current?.rows?.[0];
    if (!row || String(row.status || "") !== "active") return next();

    const persisted = row.steam_id ? String(row.steam_id) : "";
    if (persisted === steamId) return next();

    const duplicate: any = await db.execute(sql`
      SELECT discord_id FROM season_registrations
      WHERE season_number=${season} AND steam_id=${steamId} AND discord_id<>${session.userId}
      LIMIT 1
    `);

    if (duplicate?.rows?.[0]) {
      // Evita que a rota seguinte considere apenas o cookie e marque uma Steam duplicada como concluída.
      if (req.cookies) req.cookies[STEAM_COOKIE] = "";
      res.clearCookie(STEAM_COOKIE, { path: "/", secure: true, sameSite: "lax" });
      return next();
    }

    await db.execute(sql`
      UPDATE season_registrations
      SET steam_id=${steamId}, updated_at=now()
      WHERE season_number=${season} AND discord_id=${session.userId} AND status='active'
    `);
  } catch (error) {
    req.log?.error?.({ error }, "season steam registration repair failed");
  }

  return next();
});

export default router;
