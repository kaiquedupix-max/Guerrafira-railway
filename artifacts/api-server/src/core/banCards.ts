import { EmbedBuilder, type Message } from "discord.js";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, modLogsTable } from "@workspace/db";
import { discordClient } from "../bot/client.js";
import { getSteamProfileSummaries } from "../admin/steamProfiles.js";
import { logger } from "../lib/logger.js";

/** Called under the per-player network lock, never by each server separately. */
export async function reconcileBanCard(steamId: string): Promise<void> {
  const client = discordClient();
  if (!client) {
    if (process.env.DISCORD_LOG_CHANNEL_ID || process.env.TRIO_DISCORD_LOG_CHANNEL_ID) throw new Error("Discord indisponível; atualização do card pendente.");
    return;
  }
  const history = await db.select().from(modLogsTable).where(and(
    eq(modLogsTable.steamId, steamId),
    inArray(modLogsTable.action, ["BAN", "PREVENTIVE_BAN", "DESBANIR", "SYSTEM_UNBAN", "BAN_CARD_REFERENCE"]),
  )).orderBy(desc(modLogsTable.id));
  const states = ["solo-duo", "trio"].map(server => history.find(row => row.serverId === server && row.action !== "BAN_CARD_REFERENCE"));
  const isBan = (row: typeof states[number]) => row?.action === "BAN" || row?.action === "PREVENTIVE_BAN";
  if (isBan(states[0]) !== isBan(states[1])) return;
  const ban = isBan(states[0]) ? states[0] : null;
  const ids = [...new Set([process.env.DISCORD_LOG_CHANNEL_ID, process.env.TRIO_DISCORD_LOG_CHANNEL_ID].filter((id): id is string => Boolean(id)))];
  const existing: Message[] = [];
  const reference = history.find(row => row.action === "BAN_CARD_REFERENCE");
  const clientReady = client.isReady();
  if (!clientReady) throw new Error("Discord ainda não está conectado; card pendente.");
  if (reference?.reason) {
    const saved = JSON.parse(reference.reason) as { channelId: string; messageId: string };
    const channel = await client.channels.fetch(saved.channelId);
    if (channel?.isTextBased() && "messages" in channel) {
      try { existing.push(await channel.messages.fetch(saved.messageId)); }
      catch (error) { if ((error as { code?: number }).code !== 10008) throw error; }
    }
  }
  // Include legacy per-server cards; pagination also finds cards older than 100 messages.
  for (const id of reference ? [] : ids) {
    const channel = await client.channels.fetch(id);
    if (!channel?.isTextBased() || !("messages" in channel)) continue;
    let before: string | undefined;
    for (;;) {
      const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      for (const message of page.values()) {
        if (message.author.id === client.user?.id && message.embeds.some(embed =>
          /Banimento/i.test(embed.title || "") && embed.fields.some(field => field.name === "SteamID" && field.value.replace(/`/g, "").trim() === steamId),
        )) existing.push(message);
      }
      if (page.size < 100) break;
      before = page.last()!.id;
    }
  }
  if (!ban) {
    for (const message of existing) await message.delete();
    if (reference) await db.update(modLogsTable).set({ action: "BAN_CARD_DELETED" }).where(eq(modLogsTable.id, reference.id));
    return;
  }
  const preventive = ban.action === "PREVENTIVE_BAN";
  const embed = new EmbedBuilder().setColor(preventive ? 0xf59e0b : 0xc0392b)
    .setAuthor({ name: "GUERRA FRIA • MODERAÇÃO" })
    .setTitle(preventive ? "Banimento preventivo" : "Banimento aplicado")
    .setDescription("**Banido de todos os servidores do Guerra Fria.**")
    .addFields(
      { name: "Jogador", value: ban.playerName, inline: true },
      { name: "SteamID", value: `\`${steamId}\``, inline: true },
      { name: "Duração", value: preventive ? "Até revisão" : ({ "3d": "3 dias", "7d": "7 dias", "30d": "30 dias", perm: "Permanente" } as Record<string, string>)[ban.banDuration || "perm"] || "Permanente", inline: true },
      { name: "Motivo", value: ban.reason || "Não informado" },
      { name: "Responsável", value: ban.adminName },
      { name: "Perfil Steam", value: `[Abrir perfil](https://steamcommunity.com/profiles/${steamId})`, inline: true },
    ).setFooter({ text: "Guerra Fria • Duo e Trio" }).setTimestamp(ban.createdAt);
  try {
    const steam = (await getSteamProfileSummaries([steamId])).get(steamId);
    if (steam?.avatarUrl) embed.setThumbnail(steam.avatarUrl);
  } catch (error) { logger.warn({ error, steamId }, "Ban card avatar unavailable"); }
  const [keep, ...duplicates] = existing;
  let card = keep;
  if (keep) await keep.edit({ embeds: [embed], allowedMentions: { parse: [] } });
  else {
    const channel = ids[0] ? await client.channels.fetch(ids[0]) : null;
    if (channel?.isSendable()) card = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  }
  for (const message of duplicates) await message.delete();
  if (card && (!reference || card.id !== keep?.id)) {
    if (reference) await db.update(modLogsTable).set({ action: "BAN_CARD_DELETED" }).where(eq(modLogsTable.id, reference.id));
    await db.insert(modLogsTable).values({ serverId: "solo-duo", action: "BAN_CARD_REFERENCE", steamId, playerName: ban.playerName, reason: JSON.stringify({ channelId: card.channelId, messageId: card.id }), adminId: "SYSTEM", adminName: "Sistema", publicVisible: false });
  }
}
