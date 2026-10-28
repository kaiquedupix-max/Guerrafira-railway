import { adminServer } from "../core/adminServerContext.js";
import { Router } from "express";
import { EmbedBuilder } from "discord.js";
import { db, modLogsTable, playersTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { executeRconCommand } from "../bot/utils/rcon.js";
import { discordClient } from "../bot/client.js";
import { requireAdmin } from "./guard.js";
import { getGuerraFriaDisplayName } from "./permissions.js";
import { getPlayerBySteamId } from "../bot/utils/players.js";
import { banPlayer, ActionError } from "../core/systemActions.js";

const router = Router();
router.use(requireAdmin);
const steamRe = /^7656119\d{10}$/;
const clean = (v: unknown, n = 300) => String(v ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, n === 17 ? 18 : n);


async function getActiveWarnings(steamId: string) {
  const rows = await db.select().from(modLogsTable)
    .where(and(eq(modLogsTable.serverId, adminServer()), eq(modLogsTable.steamId, steamId)))
    .orderBy(desc(modLogsTable.createdAt), desc(modLogsTable.id));
  const removedIds = new Set(rows
    .filter(row => row.action === "WARN_REMOVED")
    .map(row => String(row.reason ?? "").match(/warningId:(\d+)/)?.[1])
    .filter((id): id is string => Boolean(id)));
  return rows.filter(row => row.action === "WARN" && !removedIds.has(String(row.id)));
}

async function sendLog(embed: EmbedBuilder): Promise<void> {
  const client = discordClient();
  const channelId = (adminServer() === "trio" ? process.env.TRIO_DISCORD_LOG_CHANNEL_ID : undefined) || process.env.DISCORD_LOG_CHANNEL_ID;
  if (!client || !channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel?.isSendable()) await channel.send({ embeds: [embed] }).catch(() => {});
}

router.get("/:steamId", async (req, res) => {
  const steamId = clean(req.params.steamId, 17);
  if (!steamRe.test(steamId)) return void res.status(400).json({ error: "SteamID inválido." });
  const rows = await getActiveWarnings(steamId);
  res.json({ warnings: rows, count: rows.length });
});

router.post("/apply", async (req, res) => {
  const steamId = clean(req.body?.steamId, 17);
  const discordUserId = clean(req.body?.discordUserId, 32);
  const reason = clean(req.body?.reason, 300);
  if (!steamRe.test(steamId) || !reason) return void res.status(400).json({ error: "SteamID ou motivo inválido." });

  const player = await getPlayerBySteamId(steamId);
  if (!player) return void res.status(404).json({ error: "Jogador não encontrado." });
  const previous = await getActiveWarnings(steamId);
  const number = previous.length + 1;
  const admin = res.locals.admin as { userId: string; username: string };
  const adminName = await getGuerraFriaDisplayName(admin.userId, admin.username);

  await db.insert(modLogsTable).values({ serverId: adminServer(),
    action: "WARN",
    steamId,
    playerName: player.playerName,
    reason: discordUserId ? `${reason} | Discord: ${discordUserId} | Advertência ${number}/3` : `${reason} | Advertência ${number}/3`,
    adminId: admin.userId,
    adminName,
  });

  await sendLog(
    new EmbedBuilder()
      .setColor(0xff9a2f)
      .setTitle(`⚠️ Advertência aplicada • ${number}/3`)
      .setDescription("Uma advertência administrativa foi registrada no sistema Guerra Fria.")
      .addFields(
        { name: "Jogador", value: player.playerName, inline: true },
        { name: "SteamID", value: `\`${steamId}\``, inline: true },
        { name: "Advertências", value: `**${number}/3**`, inline: true },
        { name: "Motivo", value: reason },
        ...(discordUserId ? [{ name: "Discord do jogador", value: `<@${discordUserId}>`, inline: true }] : []),
        { name: "Responsável", value: `<@${admin.userId}> • **${adminName}**`, inline: true },
      )
      .setFooter({ text: "Guerra Fria • Administração" })
      .setTimestamp(),
  );

  await executeRconCommand(`say <color=#FF9A2F>[ADVERTÊNCIA ${number}/3]</color> ${player.playerName}: ${reason.replace(/"/g, "'")}`).catch(() => {});

  if (number >= 3) {
    try {
      await banPlayer({
        steamId,
        playerName: player.playerName,
        duration: "perm",
        reason: "Banimento automático após 3 advertências.",
        actor: { id: admin.userId, name: adminName, source: "web" },
      });
    } catch (error) {
      const e = error instanceof ActionError ? error : new ActionError("Advertência registrada, mas o banimento automático não foi confirmado.", 503);
      return void res.status(e.status).json({ error: e.message, warnings: number, banned: false });
    }

    return void res.json({ ok: true, warnings: number, banned: true });
  }

  res.json({ ok: true, warnings: number, banned: false });
});

router.post("/remove", async (req, res) => {
  const steamId = clean(req.body?.steamId, 17);
  const reason = clean(req.body?.reason, 300);
  if (!steamRe.test(steamId) || !reason) return void res.status(400).json({ error: "SteamID ou motivo inválido." });

  const active = await getActiveWarnings(steamId);
  const warning = active[0];
  if (!warning) return void res.status(409).json({ error: "O jogador não possui advertência ativa." });

  const admin = res.locals.admin as { userId: string; username: string };
  const adminName = await getGuerraFriaDisplayName(admin.userId, admin.username);
  await db.insert(modLogsTable).values({ serverId: adminServer(),
    action: "WARN_REMOVED",
    steamId,
    playerName: warning.playerName,
    reason: `warningId:${warning.id} | ${reason}`,
    adminId: admin.userId,
    adminName,
  });

  const remaining = active.length - 1;
  await sendLog(new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle("✅ Advertência removida")
    .addFields(
      { name: "Jogador", value: warning.playerName, inline: true },
      { name: "SteamID", value: `\`${steamId}\``, inline: true },
      { name: "Advertências restantes", value: `**${remaining}/3**`, inline: true },
      { name: "Motivo da remoção", value: reason },
      { name: "Responsável", value: `<@${admin.userId}> • **${adminName}**` },
    )
    .setFooter({ text: "Guerra Fria • Administração" })
    .setTimestamp());

  res.json({ ok: true, warnings: remaining, removedWarningId: warning.id });
});

export default router;
