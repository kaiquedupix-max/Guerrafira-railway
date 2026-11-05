import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getCommunitySession } from "../admin/communitySession.js";
import { getAdminSessionV3 } from "../admin/sessionBearer.js";
import { logger } from "../lib/logger.js";

const router = Router();
const steamId = /^7656119\d{10}$/;
type Player = { name: string; steamId: string };

export async function ensureBaseInvadersSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS base_invaders_teams (
      id BIGSERIAL PRIMARY KEY,
      team_name TEXT NOT NULL,
      captain_discord_id TEXT NOT NULL,
      captain_discord_name TEXT NOT NULL,
      players JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS base_invaders_unique_active_captain
    ON base_invaders_teams(captain_discord_id) WHERE status IN ('pending','approved')
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS base_invaders_unique_active_name
    ON base_invaders_teams(lower(team_name)) WHERE status IN ('pending','approved')
  `);
}

function parsePlayers(input: unknown): Player[] | null {
  if (!Array.isArray(input) || input.length !== 3) return null;
  const players: Player[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    const p = item as Record<string, unknown>;
    const name = typeof p.name === "string" ? p.name.trim() : "";
    const id = typeof p.steamId === "string" ? p.steamId.trim() : "";
    if (name.length < 2 || name.length > 32 || !steamId.test(id)) return null;
    players.push({ name, steamId: id });
  }
  if (new Set(players.map(p => p.steamId)).size !== 3) return null;
  return players;
}

router.post("/base-invaders/inscricoes", async (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return void res.status(401).json({ error: "Entre com o Discord antes de inscrever seu trio." });
  const origin = req.get("origin");
  const host = String(req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
  if (origin) {
    try {
      if (new URL(origin).host !== host) return void res.status(403).json({ error: "Origem não autorizada." });
    } catch { return void res.status(403).json({ error: "Origem inválida." }); }
  }
  const teamName = typeof req.body?.teamName === "string" ? req.body.teamName.trim() : "";
  const players = parsePlayers(req.body?.players);
  if (teamName.length < 3 || teamName.length > 36 || /[<>]/.test(teamName))
    return void res.status(400).json({ error: "O nome da equipe deve ter de 3 a 36 caracteres." });
  if (!players) return void res.status(400).json({ error: "Informe exatamente 3 jogadores com nomes e SteamIDs 64 diferentes." });
  if (req.body?.acceptRules !== true) return void res.status(400).json({ error: "É necessário aceitar o regulamento." });
  try {
    const duplicate: any = await db.execute(sql`
      SELECT 1 FROM base_invaders_teams t
      CROSS JOIN LATERAL jsonb_array_elements(t.players) p
      WHERE t.status IN ('pending','approved')
      AND p->>'steamId' IN (${players[0].steamId},${players[1].steamId},${players[2].steamId})
      LIMIT 1
    `);
    if (duplicate?.rows?.length) return void res.status(409).json({ error: "Um dos SteamIDs já está inscrito em outra equipe." });
    await db.execute(sql`
      INSERT INTO base_invaders_teams(team_name,captain_discord_id,captain_discord_name,players,status)
      VALUES (${teamName},${session.userId},${session.username},${JSON.stringify(players)}::jsonb,'pending')
    `);
    return void res.status(201).json({ ok: true, teamName, status: "pending", price: 0, slots: 3 });
  } catch (error: any) {
    if (error?.code === "23505" || error?.cause?.code === "23505")
      return void res.status(409).json({ error: "Esse nome de equipe ou capitão já possui uma inscrição ativa." });
    logger.error({ error }, "Falha na inscrição Base Invaders");
    return void res.status(500).json({ error: "Não foi possível salvar sua inscrição. Tente novamente." });
  }
});

router.get("/base-invaders/minha-inscricao", async (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return void res.status(401).json({ error: "Login necessário." });
  try {
    const result: any = await db.execute(sql`
      SELECT id,team_name,players,status,created_at
      FROM base_invaders_teams WHERE captain_discord_id=${session.userId}
      AND status IN ('pending','approved') ORDER BY id DESC LIMIT 1
    `);
    return void res.status(200).json({ registration: result?.rows?.[0] || null });
  } catch (error) {
    logger.error({ error }, "Erro ao consultar inscrição Base Invaders");
    return void res.status(500).json({ error: "Falha ao consultar inscrição." });
  }
});

router.get("/base-invaders/inscricoes", async (req, res) => {
  const session = getCommunitySession(req);
  const admin = getAdminSessionV3(req);
  if (!session?.isAdmin && !admin) return void res.status(403).json({ error: "Somente a equipe administrativa pode listar as inscrições." });
  try {
    const result: any = await db.execute(sql`
      SELECT id,team_name,captain_discord_id,captain_discord_name,players,status,created_at
      FROM base_invaders_teams ORDER BY created_at DESC LIMIT 500
    `);
    return void res.status(200).json({ teams: result?.rows || [] });
  } catch (error) {
    logger.error({ error }, "Erro ao listar Base Invaders");
    return void res.status(500).json({ error: "Falha ao carregar equipes." });
  }
});

export default router;
