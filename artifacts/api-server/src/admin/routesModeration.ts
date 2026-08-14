import { Router } from "express";
import { EmbedBuilder } from "discord.js";
import { db, modLogsTable, playersTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { executeRconCommand } from "../bot/utils/rcon.js";
import { discordClient } from "../bot/client.js";
import { requireAdmin } from "./guard.js";
import { getGuerraFriaDisplayName } from "./permissions.js";

const router = Router();
router.use(requireAdmin);
const steamRe = /^7656119\d{10}$/;
const clean = (v: unknown, n = 200) => String(v ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, n);

async function sendServerLog(embed: EmbedBuilder): Promise<void> {
  const client = discordClient();
  const channelId = process.env.DISCORD_LOG_CHANNEL_ID;
  if (!client || !channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel?.isSendable()) await channel.send({ embeds: [embed] });
}

router.post("/ban", async (req, res) => {
  const steamId = clean(req.body?.steamId, 17);
  const duration = clean(req.body?.duration, 8);
  const reason = clean(req.body?.reason, 300);
  if (!steamRe.test(steamId) || !["3d","7d","30d","perm"].includes(duration) || !reason) return res.status(400).json({ error: "Dados inválidos." });
  const [p] = await db.select().from(playersTable).where(eq(playersTable.steamId, steamId)).limit(1);
  const name = p?.playerName ?? `Jogador (${steamId})`;
  const days = duration === "3d" ? 3 : duration === "7d" ? 7 : duration === "30d" ? 30 : 0;
  const expiresAt = days ? new Date(Date.now() + days * 86400000) : null;
  const result = await executeRconCommand(`banid ${steamId} "${name.replace(/"/g, "'")}" "[${duration.toUpperCase()}] ${reason.replace(/"/g, "'")} | Recurso: discord.gg/guerrafria"`);
  const admin = res.locals.admin as { userId: string; username: string };
  const adminName = await getGuerraFriaDisplayName(admin.userId, admin.username);
  await db.insert(modLogsTable).values({ action: "BAN", steamId, playerName: name, reason, adminId: admin.userId, adminName, banDuration: duration, banExpiresAt: expiresAt });
  await sendServerLog(new EmbedBuilder().setColor(0xe74c3c).setTitle("🔨 Banimento aplicado").addFields(
    { name: "Jogador", value: name, inline: true },
    { name: "SteamID", value: `\`${steamId}\``, inline: true },
    { name: "Duração", value: duration, inline: true },
    { name: "Motivo", value: reason },
    { name: "Admin", value: `<@${admin.userId}> • Painel Web` },
  ).setFooter({ text: "Guerra Fria • Moderação" }).setTimestamp());
  res.json({ ok: true, rcon: result !== null });
});

router.post("/kick", async (req, res) => {
  const steamId = clean(req.body?.steamId, 17);
  const reason = clean(req.body?.reason, 300);
  const [p] = await db.select().from(playersTable).where(eq(playersTable.steamId, steamId)).limit(1);
  if (!steamRe.test(steamId) || !reason || !p?.isOnline) return res.status(400).json({ error: "Jogador offline ou dados inválidos." });
  const result = await executeRconCommand(`kick "${p.playerName.replace(/"/g, "'")}" "${reason.replace(/"/g, "'")}"`);
  if (result === null) return res.status(503).json({ error: "RCON indisponível." });
  const admin = res.locals.admin as { userId: string; username: string };
  const adminName = await getGuerraFriaDisplayName(admin.userId, admin.username);
  await db.insert(modLogsTable).values({ action: "KICK", steamId, playerName: p.playerName, reason, adminId: admin.userId, adminName });
  await sendServerLog(new EmbedBuilder().setColor(0x7c3aed).setTitle("👢 Jogador kickado").addFields(
    { name: "Jogador", value: p.playerName, inline: true },
    { name: "SteamID", value: `\`${steamId}\``, inline: true },
    { name: "Motivo", value: reason },
    { name: "Admin", value: `<@${admin.userId}> • Painel Web` },
  ).setFooter({ text: "Guerra Fria • Moderação" }).setTimestamp());
  res.json({ ok: true });
});

router.post("/unban", async (req, res) => {
  const steamId = clean(req.body?.steamId, 17);
  const reason = clean(req.body?.reason, 300);
  if (!steamRe.test(steamId) || !reason) return res.status(400).json({ error: "SteamID ou motivo inválido." });

  const bans = await db.select().from(modLogsTable)
    .where(and(eq(modLogsTable.action, "BAN"), eq(modLogsTable.steamId, steamId)))
    .orderBy(desc(modLogsTable.createdAt));
  const latestBan = bans[0];
  if (!latestBan) return res.status(404).json({ error: "Nenhum banimento encontrado para este jogador." });

  const stateRows = await db.select().from(modLogsTable)
    .where(eq(modLogsTable.steamId, steamId))
    .orderBy(desc(modLogsTable.createdAt))
    .limit(100);
  const latestBanState = stateRows.find(x => x.action === "BAN" || x.action === "DESBANIR" || x.action === "SYSTEM_UNBAN");
  if (!latestBanState || latestBanState.action !== "BAN") return res.status(409).json({ error: "Este jogador não possui banimento ativo." });

  const result = await executeRconCommand(`unban ${steamId}`);
  const admin = res.locals.admin as { userId: string; username: string };
  const adminName = await getGuerraFriaDisplayName(admin.userId, admin.username);

  await db.insert(modLogsTable).values({
    action: "DESBANIR",
    steamId,
    playerName: latestBan.playerName,
    reason,
    adminId: admin.userId,
    adminName,
  });

  await sendServerLog(new EmbedBuilder().setColor(0x22c55e).setTitle("✅ Jogador desbanido").addFields(
    { name: "Jogador", value: latestBan.playerName, inline: true },
    { name: "SteamID", value: `\`${steamId}\``, inline: true },
    { name: "Motivo", value: reason },
    { name: "Admin", value: `<@${admin.userId}> • Painel Web` },
  ).setFooter({ text: "Guerra Fria • Moderação" }).setTimestamp());

  res.json({ ok: true, rcon: result !== null });
});

router.post("/verify", async (req, res) => {
  const steamId = clean(req.body?.steamId, 17);
  const discordUserId = clean(req.body?.discordUserId, 32);
  if (!steamRe.test(steamId) || !discordUserId) return res.status(400).json({ error: "SteamID ou Discord ID inválido." });
  const [p] = await db.select().from(playersTable).where(eq(playersTable.steamId, steamId)).limit(1);
  if (!p) return res.status(404).json({ error: "Jogador não encontrado no histórico." });
  const client = discordClient();
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!client || !guildId) return res.status(503).json({ error: "Discord indisponível." });
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(discordUserId).catch(() => null) : null;
  if (!member) return res.status(404).json({ error: "Membro do Discord não encontrado." });
  const roleId = process.env.DISCORD_VERIFIED_ROLE_ID;
  if (roleId && !member.roles.cache.has(roleId)) await member.roles.add(roleId, "Verificado pelo Painel Web");
  const command = (process.env.VERIFIED_GAME_ADD_CMD?.trim() || "oxide.usergroup add {steamid} vr").replace(/\{steam[Ii][Dd]\}/g, steamId);
  const rcon = await executeRconCommand(command);
  const admin = res.locals.admin as { userId: string; username: string };
  const adminName = await getGuerraFriaDisplayName(admin.userId, admin.username);
  await db.insert(modLogsTable).values({ action: "VERIFICAR", steamId, playerName: p.playerName, reason: `Triagem concluída — Discord: ${member.displayName || member.user.globalName || member.user.username}`, adminId: admin.userId, adminName });
  await sendServerLog(new EmbedBuilder().setColor(0x22c55e).setTitle("🛡️ Jogador verificado").addFields(
    { name: "Jogador", value: p.playerName, inline: true },
    { name: "SteamID", value: `\`${steamId}\``, inline: true },
    { name: "Discord", value: `<@${discordUserId}>`, inline: true },
    { name: "Admin", value: `<@${admin.userId}> • Painel Web` },
  ).setFooter({ text: "Guerra Fria • Verificação" }).setTimestamp());
  await executeRconCommand(`say <color=#00FF88>[VERIFICAÇÃO CONCLUÍDA]</color> | <color=#FF8800>${p.playerName}</color> foi verificado pela administração. <color=#00FF88>O jogador foi considerado LIMPO.</color>`).catch(() => {});
  res.json({ ok: true, rcon: rcon !== null });
});

export default router;
