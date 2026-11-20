import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
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
  await db.execute(sql`ALTER TABLE base_invaders_teams ADD COLUMN IF NOT EXISTS registration_mode TEXT NOT NULL DEFAULT 'trio'`);
}

function parsePlayers(input: unknown): Player[] | null {
  if (!Array.isArray(input) || input.length < 1 || input.length > 3) return null;
  const players: Player[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    const p = item as Record<string, unknown>;
    const name = typeof p.name === "string" ? p.name.trim() : "";
    const id = typeof p.steamId === "string" ? p.steamId.trim() : "";
    if (name.length < 2 || name.length > 32 || !steamId.test(id)) return null;
    players.push({ name, steamId: id });
  }
  if (new Set(players.map(p => p.steamId)).size !== players.length) return null;
  return players;
}

function parsePair(input: unknown): Player[] | null {
  const players = parsePlayers(input);
  return players?.length === 2 ? players : null;
}

function parseSinglePlayer(input: unknown): Player[] | null {
  if (!Array.isArray(input) || input.length !== 1) return null;
  const item = input[0];
  if (!item || typeof item !== "object") return null;
  const p = item as Record<string, unknown>;
  const name = typeof p.name === "string" ? p.name.trim() : "";
  const id = typeof p.steamId === "string" ? p.steamId.trim() : "";
  if (name.length < 2 || name.length > 32 || /[<>]/.test(name) || !steamId.test(id)) return null;
  return [{ name, steamId: id }];
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
  const registrationMode = ["random", "duo"].includes(req.body?.registrationMode) ? req.body.registrationMode : "trio";
  const teamName = typeof req.body?.teamName === "string" ? req.body.teamName.trim() : "";
  const parsedTeam = registrationMode === "duo" ? parsePair(req.body?.players) : parsePlayers(req.body?.players);
  const players = registrationMode === "random" ? parseSinglePlayer(req.body?.players)
    : registrationMode === "duo" ? parsedTeam : parsedTeam?.length === 3 ? parsedTeam : null;
  if (registrationMode !== "random" && (teamName.length < 3 || teamName.length > 36 || /[<>]/.test(teamName)))
    return void res.status(400).json({ error: "O nome da equipe deve ter de 3 a 36 caracteres." });
  if (!players) return void res.status(400).json({ error: registrationMode === "random" ? "Informe seu nick e SteamID64 válidos." : registrationMode === "duo" ? "Informe exatamente 2 jogadores com nomes e SteamIDs64 diferentes." : "Informe exatamente 3 jogadores com nomes e SteamIDs64 diferentes." });
  if (req.body?.acceptRules !== true) return void res.status(400).json({ error: "É necessário aceitar o regulamento." });
  const savedTeamName = registrationMode === "random" ? "Sorteio-" + session.userId : teamName;
  try {
    const duplicate: any = await db.execute(sql`
      SELECT 1 FROM base_invaders_teams t
      CROSS JOIN LATERAL jsonb_array_elements(t.players) p
      WHERE t.status IN ('pending','approved')
      AND p->>'steamId' IN (${players[0].steamId},${players[1]?.steamId ?? ''},${players[2]?.steamId ?? ''})
      LIMIT 1
    `);
    if (duplicate?.rows?.length) return void res.status(409).json({ error: "Um dos SteamIDs já está inscrito em outra equipe." });
    await db.execute(sql`
      INSERT INTO base_invaders_teams(team_name,captain_discord_id,captain_discord_name,players,status,registration_mode)
      VALUES (${savedTeamName},${session.userId},${session.username},${JSON.stringify(players)}::jsonb,'pending',${registrationMode})
    `);
    return void res.status(201).json({ ok: true, teamName: registrationMode !== "random" ? savedTeamName : null, registrationMode, status: "pending", price: 0, slots: players.length });
  } catch (error: any) {
    if (error?.code === "23505" || error?.cause?.code === "23505")
      return void res.status(409).json({ error: "Esse nome de equipe ou capitão já possui uma inscrição ativa." });
    logger.error({ error }, "Falha na inscrição Guerra Fria Invaders");
    return void res.status(500).json({ error: "Não foi possível salvar sua inscrição. Tente novamente." });
  }
});

router.get("/base-invaders/minha-inscricao", async (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return void res.status(401).json({ error: "Login necessário." });
  try {
    const result: any = await db.execute(sql`
      SELECT id,team_name,registration_mode,players,status,created_at
      FROM base_invaders_teams WHERE captain_discord_id=${session.userId}
      AND status IN ('pending','approved') ORDER BY id DESC LIMIT 1
    `);
    return void res.status(200).json({ registration: result?.rows?.[0] || null });
  } catch (error) {
    logger.error({ error }, "Erro ao consultar inscrição Guerra Fria Invaders");
    return void res.status(500).json({ error: "Falha ao consultar inscrição." });
  }
});

router.put("/base-invaders/minha-inscricao", async (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return void res.status(401).json({ error: "Entre com o Discord para editar sua inscrição." });
  const teamName = typeof req.body?.teamName === "string" ? req.body.teamName.trim() : "";
  const players = parsePlayers(req.body?.players);
  if (!players) return void res.status(400).json({ error: "Informe de 1 a 3 jogadores com nomes e SteamIDs64 válidos e diferentes." });
  try {
    const current: any = await db.execute(sql`
      SELECT id,team_name,registration_mode FROM base_invaders_teams
      WHERE captain_discord_id=${session.userId} AND status IN ('pending','approved')
      ORDER BY id DESC LIMIT 1
    `);
    const registration = current?.rows?.[0];
    if (!registration) return void res.status(404).json({ error: "Não encontramos uma inscrição ativa sua para editar." });
    const isRandom = registration.registration_mode === "random";
    if (isRandom && players.length !== 1) return void res.status(400).json({ error: "A inscrição sem equipe aceita somente um jogador." });
    if (!isRandom && (!teamName || teamName.length < 3 || teamName.length > 36 || /[<>]/.test(teamName)))
      return void res.status(400).json({ error: "O nome da equipe deve ter de 3 a 36 caracteres." });

    const duplicate: any = await db.execute(sql`
      SELECT 1 FROM base_invaders_teams t
      CROSS JOIN LATERAL jsonb_array_elements(t.players) p
      WHERE t.id<>${registration.id} AND t.status IN ('pending','approved')
      AND p->>'steamId' IN (${players[0].steamId},${players[1]?.steamId ?? ''},${players[2]?.steamId ?? ''})
      LIMIT 1
    `);
    if (duplicate?.rows?.length) return void res.status(409).json({ error: "Um dos SteamIDs já está inscrito em outra equipe." });

    const result: any = await db.execute(sql`
      UPDATE base_invaders_teams SET team_name=${isRandom ? registration.team_name : teamName},
        players=${JSON.stringify(players)}::jsonb,
        registration_mode=CASE WHEN registration_mode='random' THEN 'random' ELSE ${players.length === 3 ? "trio" : "duo"} END,
        updated_at=now()
      WHERE id=${registration.id} AND captain_discord_id=${session.userId} AND status IN ('pending','approved')
      RETURNING id,team_name,registration_mode,players,status,created_at
    `);
    if (!result?.rows?.length) return void res.status(404).json({ error: "Inscrição não encontrada." });
    logger.info({ teamId: registration.id, captainId: session.userId }, "Capitão editou inscrição Guerra Fria Invaders");
    return void res.status(200).json({ registration: result.rows[0] });
  } catch (error: any) {
    if (error?.code === "23505" || error?.cause?.code === "23505")
      return void res.status(409).json({ error: "Já existe uma inscrição ativa com esse nome de equipe." });
    logger.error({ error, captainId: session.userId }, "Falha ao editar inscrição própria Guerra Fria Invaders");
    return void res.status(500).json({ error: "Não foi possível salvar sua inscrição." });
  }
});

router.get("/base-invaders/inscricoes", async (req, res) => {
  const session = getCommunitySession(req);
  const admin = getAdminSessionV3(req);
  if (!session?.isAdmin && !admin) return void res.status(403).json({ error: "Somente a equipe administrativa pode listar as inscrições." });
  try {
    const result: any = await db.execute(sql`
      SELECT id,team_name,registration_mode,captain_discord_id,captain_discord_name,players,status,created_at
      FROM base_invaders_teams ORDER BY created_at DESC LIMIT 500
    `);
    return void res.status(200).json({ teams: result?.rows || [] });
  } catch (error) {
    logger.error({ error }, "Erro ao listar Guerra Fria Invaders");
    return void res.status(500).json({ error: "Falha ao carregar equipes." });
  }
});


router.delete("/base-invaders/inscricoes/:id", async (req, res) => {
  const session = getCommunitySession(req);
  const admin = getAdminSessionV3(req);
  if (!session?.isAdmin && !admin) return void res.status(403).json({ error: "Somente administradores podem excluir inscrições." });
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return void res.status(400).json({ error: "Equipe inválida." });
  try {
    const result: any = await db.execute(sql`
      UPDATE base_invaders_teams SET status='deleted',updated_at=now()
      WHERE id=${id} AND status<>'deleted'
      RETURNING id,team_name,status
    `);
    if (!result?.rows?.length) return void res.status(404).json({ error: "Equipe não encontrada ou já excluída." });
    logger.info({ teamId: id, adminId: session?.userId || admin?.userId }, "Inscrição Guerra Fria Invaders excluída");
    return void res.status(200).json({ team: result.rows[0] });
  } catch (error) {
    logger.error({ error, teamId: id }, "Falha ao excluir inscrição Guerra Fria Invaders");
    return void res.status(500).json({ error: "Erro ao excluir a equipe." });
  }
});

router.post("/base-invaders/inscricoes/:id/status", async (req, res) => {
  const session = getCommunitySession(req);
  const admin = getAdminSessionV3(req);
  if (!session?.isAdmin && !admin) return void res.status(403).json({ error: "Apenas administradores podem decidir inscrições." });
  const id = Number(req.params.id);
  const status = req.body?.status;
  if (!Number.isSafeInteger(id) || id <= 0 || !["pending", "approved", "rejected"].includes(status))
    return void res.status(400).json({ error: "Inscrição ou status inválido." });
  try {
    const result: any = await db.execute(sql`
      UPDATE base_invaders_teams SET status=${status},updated_at=now()
      WHERE id=${id} RETURNING id,team_name,status
    `);
    if (!result?.rows?.length) return void res.status(404).json({ error: "Equipe não encontrada." });
    logger.info({ teamId: id, status, adminId: session?.userId || admin?.userId }, "Inscrição Guerra Fria Invaders moderada");
    return void res.status(200).json({ team: result.rows[0] });
  } catch (error: any) {
    if (error?.code === "23505" || error?.cause?.code === "23505")
      return void res.status(409).json({ error: "Existe outra inscrição ativa com esse capitão ou nome de equipe." });
    logger.error({ error, teamId: id }, "Falha ao moderar Guerra Fria Invaders");
    return void res.status(500).json({ error: "Erro ao atualizar status." });
  }
});

router.put("/base-invaders/inscricoes/:id", async (req, res) => {
  const session = getCommunitySession(req);
  const admin = getAdminSessionV3(req);
  if (!session?.isAdmin && !admin) return void res.status(403).json({ error: "Somente a equipe administrativa pode editar as inscrições." });
  const id = Number(req.params.id);
  const teamName = typeof req.body?.teamName === "string" ? req.body.teamName.trim() : "";
  const players = parsePlayers(req.body?.players);
  if (!Number.isSafeInteger(id) || id <= 0) return void res.status(400).json({ error: "Equipe inválida." });
  if (!teamName || teamName.length > 36 || /[<>]/.test(teamName)) return void res.status(400).json({ error: "O nome da equipe deve ter até 36 caracteres." });
  if (!players) return void res.status(400).json({ error: "Mantenha de 1 a 3 jogadores com nomes e SteamIDs64 válidos e diferentes." });
  try {
    const duplicate: any = await db.execute(sql`
      SELECT 1 FROM base_invaders_teams t
      CROSS JOIN LATERAL jsonb_array_elements(t.players) p
      WHERE t.id<>${id} AND t.status IN ('pending','approved')
      AND p->>'steamId' IN (${players[0].steamId},${players[1]?.steamId ?? ''},${players[2]?.steamId ?? ''})
      LIMIT 1
    `);
    if (duplicate?.rows?.length) return void res.status(409).json({ error: "Um dos SteamIDs já está inscrito em outra equipe." });
    const result: any = await db.execute(sql`
      UPDATE base_invaders_teams SET team_name=${teamName},players=${JSON.stringify(players)}::jsonb,
        registration_mode=CASE WHEN registration_mode='random' THEN 'random' ELSE ${players.length === 3 ? "trio" : "duo"} END,updated_at=now()
      WHERE id=${id} RETURNING id,team_name,registration_mode,players,status
    `);
    if (!result?.rows?.length) return void res.status(404).json({ error: "Equipe não encontrada." });
    logger.info({ teamId: id, adminId: session?.userId || admin?.userId }, "Inscrição Guerra Fria Invaders editada");
    return void res.status(200).json({ team: result.rows[0] });
  } catch (error: any) {
    if (error?.code === "23505" || error?.cause?.code === "23505")
      return void res.status(409).json({ error: "Já existe uma inscrição ativa com esse nome de equipe." });
    logger.error({ error, teamId: id }, "Falha ao editar inscrição Guerra Fria Invaders");
    return void res.status(500).json({ error: "Erro ao editar a equipe." });
  }
});

// Contagem pública de inscrições ativas (pendentes e aprovadas). Não expõe nomes nem SteamIDs.
router.get("/base-invaders/contagem", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const result: any = await db.execute(sql`
SELECT registration_mode, COUNT(*)::int AS teams, COALESCE(SUM(jsonb_array_length(players)), 0)::int AS players
FROM base_invaders_teams WHERE status IN ('pending','approved') GROUP BY registration_mode
`);
    let trioTeams = 0;
    let trioPlayers = 0;
    let soloPlayers = 0;
    for (const row of result?.rows || []) {
      if (row.registration_mode === "random") soloPlayers += Number(row.players);
      else {
        trioTeams += Number(row.teams);
        trioPlayers += Number(row.players);
      }
    }
    return void res.status(200).json({ trioTeams, trioPlayers, soloPlayers, totalPlayers: trioPlayers + soloPlayers });
  } catch (error) {
    logger.error({ error }, "Erro ao contar inscrições Guerra Fria Invaders");
    return void res.status(500).json({ error: "Falha ao contar inscrições." });
  }
});

// Exporta só as inscrições aprovadas para o plugin do servidor. Protegido por token compartilhado (INVADERS_SYNC_TOKEN).
router.get("/base-invaders/exportacao", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const expected = process.env.INVADERS_SYNC_TOKEN || "";
  const provided = String(req.get("x-invaders-token") || "");
  const authorized = expected.length > 0
    && provided.length === expected.length
    && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!authorized) return void res.status(401).json({ error: "Token inválido." });
  try {
    const result: any = await db.execute(sql`
SELECT id,team_name,registration_mode,players FROM base_invaders_teams WHERE status='approved' ORDER BY id
`);
    const teams = (result?.rows || []).map((row: any) => ({
      id: row.id,
      teamName: row.team_name,
      mode: row.registration_mode,
      players: row.players,
    }));
    return void res.status(200).json({ teams });
  } catch (error) {
    logger.error({ error }, "Erro ao exportar inscrições Guerra Fria Invaders");
    return void res.status(500).json({ error: "Falha ao exportar inscrições." });
  }
});

// Banner do painel do Discord: serve o arquivo de public/ para o Discord carregar pela URL.
router.get("/base-invaders/banner.png", (_req, res) => {
  const file = [
    path.resolve(process.cwd(), "artifacts/api-server/public/invaders-banner.png"),
    path.resolve(process.cwd(), "public/invaders-banner.png"),
  ].find(existsSync);
  if (!file) return void res.status(404).end();
  res.setHeader("Cache-Control", "public, max-age=86400");
  return void res.sendFile(file);
});

export default router;
