import { collectPlayerAddresses, protectPlayerIp, removePlayerIpBan } from "./ipModeration.js";
import { adminServer, withAdminServer } from "./adminServerContext.js";
import { getPlayerBySteamId } from "../bot/utils/players.js";
import { getOnlinePlayers } from "../bot/utils/rcon.js";
import { EmbedBuilder } from "discord.js";
import { desc, eq, and, inArray } from "drizzle-orm";
import { db, modLogsTable, playersTable } from "@workspace/db";
import { discordClient } from "../bot/client.js";
import { executeRconCommand } from "../bot/utils/rcon.js";
import { getSteamProfileSummaries } from "../admin/steamProfiles.js";
import { logger } from "../lib/logger.js";

export type ActionSource = "discord" | "web" | "system";
export type ActionActor = { id: string; name: string; source: ActionSource };
export type BanDuration = "3d" | "7d" | "30d" | "perm";
const steamRe = /^7656119\d{10}$/;
const safe = (value: string, max = 300) => String(value ?? "").replace(/[\r\n\t"]/g, " ").trim().slice(0, max);
const safeChat = (value: string, max = 180) => safe(value, max).replace(/[<>]/g, "");

import { ActionError } from "./actionError.js";
import { removeRustBan } from "./rustUnban.js";
export { ActionError } from "./actionError.js";

export async function executeRconRequired(command: string, attempts = 3): Promise<string> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await executeRconCommand(command);
      if (result !== null) {
        if (/unknown command|command not found|permission denied|not authorized|failed to ban|invalid steam/i.test(result)) {
          throw new ActionError("O Rust rejeitou o comando. Nenhuma alteração foi registrada.", 503);
        }
        return result;
      }
      last = new Error("RCON retornou sem confirmação");
    } catch (error) { if (error instanceof ActionError) throw error; last = error; }
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 600));
  }
  logger.error({ err: last, command: command.split(" ")[0], attempts }, "Critical RCON action failed");
  throw new ActionError("Servidor Rust indisponível. Nenhuma alteração foi registrada.", 503);
}

async function player(steamId: string) {
  if (!steamRe.test(steamId)) throw new ActionError("SteamID inválido.");
  return await getPlayerBySteamId(steamId);
}

async function log(embed: EmbedBuilder) {
  embed.addFields({ name: "Servidor", value: adminServer() === "trio" ? "Trio" : "Solo/Duo", inline: true });
  const client = discordClient(), channelId = (adminServer() === "trio" ? process.env.TRIO_DISCORD_LOG_CHANNEL_ID : undefined) || process.env.DISCORD_LOG_CHANNEL_ID;
  if (!client || !channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel?.isSendable()) await channel.send({ embeds: [embed] }).catch(error => logger.error({ error }, "Moderation log delivery failed"));
}

async function withSteamProfile(embed: EmbedBuilder, steamId: string): Promise<EmbedBuilder> {
  try {
    const steam = (await getSteamProfileSummaries([steamId])).get(steamId);
    const profileUrl = steam?.profileUrl || `https://steamcommunity.com/profiles/${steamId}`;
    embed.addFields({ name: "Perfil Steam", value: `[Abrir perfil do jogador](${profileUrl})`, inline: true });
    if (steam?.avatarUrl) embed.setThumbnail(steam.avatarUrl);
  } catch (error) {
    logger.warn({ error, steamId }, "Steam profile enrichment failed for moderation embed");
    embed.addFields({ name: "Perfil Steam", value: `[Abrir perfil do jogador](https://steamcommunity.com/profiles/${steamId})`, inline: true });
  }
  return embed;
}

const actorLabel = (actor: ActionActor) => actor.source === "web" ? `<@${actor.id}> • Painel Web` : actor.source === "system" ? actor.name : `<@${actor.id}>`;
const gameActor = (actor: ActionActor) => safeChat(actor.name, 60);

async function sendGameModerationNotice(command: string, steamId: string, type: string): Promise<boolean> {
  return executeRconRequired(command).then(() => true).catch(error => {
    logger.error({ error, steamId, type }, "In-game moderation notification failed");
    return false;
  });
}

async function banPlayerOnServer(input: { steamId: string; duration: BanDuration; reason: string; actor: ActionActor; playerName?: string; evidenceUrl?: string; skipRcon?: boolean; ipAddresses?: string[]; expiresAtOverride?: Date | null; association?: { steamId: string; playerName: string } }) {
  const row = await player(input.steamId);
  const name = safe(input.playerName || row?.playerName || `Jogador offline (${input.steamId})`, 100);
  const reason = safe(input.reason);
  if (!reason) throw new ActionError("Motivo obrigatório.");
  const days = input.duration === "3d" ? 3 : input.duration === "7d" ? 7 : input.duration === "30d" ? 30 : 0;
  const expiresAt = input.expiresAtOverride !== undefined ? input.expiresAtOverride : days ? new Date(Date.now() + days * 86400000) : null;
  const evidenceUrl = String(input.evidenceUrl || "").trim();

  const ipProtected = await protectPlayerIp({steamId:input.steamId,reason,expiresAt,ipAddresses:input.ipAddresses});
  if (!input.skipRcon) {
    await executeRconRequired(`banid ${input.steamId} "${name}" "[${input.duration.toUpperCase()}] ${reason} | Recurso: discord.gg/guerrafria"`);
  }

  const auditReason = safe(
    evidenceUrl
      ? `${safe(reason, 170)} | Provas: ${evidenceUrl}`
      : reason,
    300
  );

  await db.insert(modLogsTable).values({ serverId: adminServer(),
    action: "BAN",
    steamId: input.steamId,
    playerName: name,
    reason: auditReason,
    adminId: input.actor.id,
    adminName: input.actor.name,
    banDuration: input.duration,
    banExpiresAt: expiresAt
  });
  const banEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle(input.association ? "🔨 Banimento por associação" : "🔨 Banimento aplicado").addFields(
    { name: "Jogador", value: name, inline: true }, { name: "SteamID", value: `\`${input.steamId}\``, inline: true },
    { name: "Duração", value: input.duration, inline: true }, { name: "Motivo", value: reason }, { name: "Responsável", value: actorLabel(input.actor) }
  );

  if (evidenceUrl) {
    banEmbed.addFields({
      name: "Provas da verificação",
      value: `[Abrir evidências no Vorken](${evidenceUrl})`
    });
  }

  banEmbed.setFooter({ text: "Guerra Fria • Moderação" }).setTimestamp();
  await log(await withSteamProfile(banEmbed, input.steamId));
  const gameNotified = await sendGameModerationNotice(
    `say <color=#FF4444>[JOGADOR BANIDO]</color> | <color=#FF8800>${safeChat(name, 80)}</color> foi banido${input.association ? " por associação" : ""}. <color=#FFD166>Aplicado por:</color> <color=#FF4444>${gameActor(input.actor)}</color> | <color=#FFD166>Motivo:</color> <color=#FFFFFF>${safeChat(reason, 125)}</color>${evidenceUrl ? " | <color=#00E6C3>Provas/motivo: Discord ou www.guerrafriarust.com.br</color>" : ""}`,
    input.steamId, "BAN");
  return { playerName: name, expiresAt, gameNotified, ipProtected };
}

async function preventiveBanOnServer(input: { steamId: string; reason: string; actor: ActionActor; playerName?: string; ipAddresses?: string[] }) {
  const current = await activeBan(input.steamId);
  if (current) {const ipProtected=await protectPlayerIp({steamId:input.steamId,reason:current.reason||input.reason,expiresAt:current.banExpiresAt,ipAddresses:input.ipAddresses});return { playerName: current.playerName, expiresAt: current.banExpiresAt, gameNotified: true, ipProtected, preventive: current.action === "PREVENTIVE_BAN" };}
  const row = await player(input.steamId);
  const name = safe(input.playerName || row?.playerName || `Jogador offline (${input.steamId})`, 100);
  const reason = safe(input.reason);
  if (!reason) throw new ActionError("Motivo obrigatório.");
  const connectionMessage = `[BANIMENTO PREVENTIVO] Motivo: ${reason} | Para liberacao: entre em discord.gg/guerrafria e abra um ticket para VERIFICACAO.`;
  const ipProtected=await protectPlayerIp({steamId:input.steamId,reason,expiresAt:null,ipAddresses:input.ipAddresses});
  await executeRconRequired(`banid ${input.steamId} "${name}" "${connectionMessage}"`);
  await db.insert(modLogsTable).values({ serverId: adminServer(), action: "PREVENTIVE_BAN", steamId: input.steamId, playerName: name, reason, adminId: input.actor.id, adminName: input.actor.name, banDuration: "perm", banExpiresAt: null });
  const preventiveEmbed = new EmbedBuilder().setColor(0xf59e0b).setTitle("🛡️ Banimento preventivo aplicado").setDescription(
    "O jogador foi bloqueado preventivamente e deverá passar por **verificação administrativa** antes de retornar ao servidor."
  ).addFields(
    { name: "Jogador", value: name, inline: true }, { name: "SteamID", value: `\`${input.steamId}\``, inline: true },
    { name: "Status", value: "Preventivo • até revisão", inline: true }, { name: "Motivo", value: reason },
    { name: "Próximo passo", value: "Entrar em **discord.gg/guerrafria** e abrir um ticket para **VERIFICAÇÃO**." }, { name: "Responsável", value: actorLabel(input.actor) }
  ).setFooter({ text: "Guerra Fria • Moderação Preventiva" }).setTimestamp();
  await log(await withSteamProfile(preventiveEmbed, input.steamId));
  const gameNotified = await sendGameModerationNotice(
    `say <color=#FFB000>[BANIMENTO PREVENTIVO]</color> | <color=#FF8800>${safeChat(name, 80)}</color> foi banido preventivamente. <color=#FFD166>Aplicado por:</color> <color=#FF4444>${gameActor(input.actor)}</color> | <color=#FFD166>Motivo:</color> <color=#FFFFFF>${safeChat(reason, 130)}</color> | <color=#00FF88>Para ser desbanido, entre em discord.gg/guerrafria e abra um ticket para VERIFICAÇÃO.</color>`,
    input.steamId, "PREVENTIVE_BAN");
  return { playerName: name, expiresAt: null, gameNotified, ipProtected, preventive: true };
}

export async function kickPlayer(input: { steamId: string; reason: string; actor: ActionActor }) {
  await player(input.steamId); // Validate the SteamID before querying Rust.
  const online = (await getOnlinePlayers()).find(p => p.steamId === input.steamId);
  const row = online ? { steamId: online.steamId, playerName: online.name, isOnline: true } : null;
  if (!row?.isOnline) throw new ActionError("Jogador offline ou não encontrado.", 409);
  const reason = safe(input.reason); if (!reason) throw new ActionError("Motivo obrigatório.");
  await executeRconRequired(`kick ${row.steamId} "${reason} | Recurso: discord.gg/guerrafria"`);
  await db.insert(modLogsTable).values({ serverId: adminServer(), action: "KICK", steamId: row.steamId, playerName: row.playerName, reason, adminId: input.actor.id, adminName: input.actor.name });
  await log(new EmbedBuilder().setColor(0xf59e0b).setTitle("👢 Jogador expulso").addFields(
    { name: "Jogador", value: row.playerName, inline: true }, { name: "SteamID", value: `\`${row.steamId}\``, inline: true },
    { name: "Motivo", value: reason }, { name: "Responsável", value: actorLabel(input.actor) }
  ).setFooter({ text: "Guerra Fria • Moderação" }).setTimestamp());
  const gameNotified = await sendGameModerationNotice(
    `say <color=#FFB000>[JOGADOR EXPULSO]</color> | <color=#FF8800>${safeChat(row.playerName, 80)}</color> foi expulso do servidor. <color=#FFD166>Aplicado por:</color> <color=#FF4444>${gameActor(input.actor)}</color> | <color=#FFD166>Motivo:</color> <color=#FFFFFF>${safeChat(reason, 160)}</color>`,
    row.steamId, "KICK");
  return { playerName: row.playerName, gameNotified };
}

export async function activeBan(steamId: string) {
  if (!steamRe.test(steamId)) throw new ActionError("SteamID inválido.");
  const rows = await db.select().from(modLogsTable).where(and(eq(modLogsTable.serverId, adminServer()), eq(modLogsTable.steamId, steamId), inArray(modLogsTable.action, ["BAN", "PREVENTIVE_BAN", "DESBANIR", "SYSTEM_UNBAN"]))).orderBy(desc(modLogsTable.createdAt), desc(modLogsTable.id)).limit(1);
  const state = rows.find(x => x.action === "BAN" || x.action === "PREVENTIVE_BAN" || x.action === "DESBANIR" || x.action === "SYSTEM_UNBAN");
  return state?.action === "BAN" || state?.action === "PREVENTIVE_BAN" ? state : null;
}

async function unbanPlayerOnServer(input: { steamId: string; reason: string; actor: ActionActor }) {
  const ban = await activeBan(input.steamId);
  // A ban applied through Rust or a plugin may have no local audit entry.
  const row = await player(input.steamId);
  const playerName = ban?.playerName || row?.playerName || `Jogador (${input.steamId})`;
  const reason = safe(input.reason); if (!reason) throw new ActionError("Motivo obrigatório.");
  await removeRustBan(input.steamId, executeRconRequired);
  await removePlayerIpBan(input.steamId);
  await db.insert(modLogsTable).values({ serverId: adminServer(), action: "DESBANIR", steamId: input.steamId, playerName: playerName, reason, adminId: input.actor.id, adminName: input.actor.name });
  await log(new EmbedBuilder().setColor(0x22c55e).setTitle("✅ Jogador desbanido").addFields(
    { name: "Jogador", value: playerName, inline: true }, { name: "SteamID", value: `\`${input.steamId}\``, inline: true },
    { name: "Tipo anterior", value: ban?.action === "PREVENTIVE_BAN" ? "Banimento preventivo" : "Banimento", inline: true },
    { name: "Motivo", value: reason }, { name: "Responsável", value: actorLabel(input.actor) }
  ).setFooter({ text: "Guerra Fria • Moderação" }).setTimestamp());
  const gameNotified = await sendGameModerationNotice(
    `say <color=#00FF88>[JOGADOR DESBANIDO]</color> | <color=#FF8800>${safeChat(playerName, 80)}</color> foi desbanido. <color=#FFD166>Aplicado por:</color> <color=#FF4444>${gameActor(input.actor)}</color> | <color=#FFD166>Motivo:</color> <color=#FFFFFF>${safeChat(reason, 160)}</color>`,
    input.steamId, "UNBAN");
  return { playerName: playerName, previousType: ban?.action, gameNotified };
}

async function memberFor(discordUserId: string) {
  const client = discordClient(), guildId = process.env.DISCORD_GUILD_ID;
  if (!client || !guildId) throw new ActionError("Discord indisponível.", 503);
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(discordUserId).catch(() => null) : null;
  if (!member) throw new ActionError("Membro do Discord não encontrado.", 404);
  return member;
}

export async function verifyPlayer(input: { steamId: string; discordUserId: string; actor: ActionActor }) {
  const row = await player(input.steamId);
  if (!row) throw new ActionError("Jogador não encontrado no histórico.", 404);
  const member = await memberFor(input.discordUserId);
  const roleId = process.env.DISCORD_VERIFIED_ROLE_ID;
  const add = ((adminServer() === "trio" ? process.env.TRIO_VERIFIED_GAME_ADD_CMD : process.env.VERIFIED_GAME_ADD_CMD)?.trim() || "c.usergroup add {steamid} vr").replace(/^oxide\./i, "c.").replace(/\{steam[Ii][Dd]\}/g, input.steamId);
  const remove = ((adminServer() === "trio" ? process.env.TRIO_VERIFIED_GAME_REMOVE_CMD : process.env.VERIFIED_GAME_REMOVE_CMD)?.trim() || "c.usergroup remove {steamid} vr").replace(/^oxide\./i, "c.").replace(/\{steam[Ii][Dd]\}/g, input.steamId);
  await executeRconRequired(add);
  try {
    if (roleId && !member.roles.cache.has(roleId)) await member.roles.add(roleId, `Verificado por ${input.actor.name}`);
  } catch (error) {
    await executeRconRequired(remove).catch(() => {});
    throw new ActionError("Não foi possível atribuir o cargo no Discord; a alteração no Rust foi revertida.", 503);
  }
  await db.insert(modLogsTable).values({ serverId: adminServer(), action: "VERIFICAR", steamId: input.steamId, playerName: row.playerName, reason: `Triagem concluída — Discord: ${member.user.tag}`, adminId: input.actor.id, adminName: input.actor.name });
  const verifyEmbed = new EmbedBuilder().setColor(0x22c55e).setTitle("🛡️ Jogador verificado").addFields(
    { name: "Jogador", value: row.playerName, inline: true }, { name: "SteamID", value: `\`${input.steamId}\``, inline: true },
    { name: "Discord", value: `<@${input.discordUserId}>`, inline: true }, { name: "Responsável", value: actorLabel(input.actor) }
  ).setFooter({ text: "Guerra Fria • Verificação" }).setTimestamp();
  await log(await withSteamProfile(verifyEmbed, input.steamId));
  const notification = `say <color=#00FF88>[VERIFICAÇÃO CONCLUÍDA]</color> | <color=#FF8800>${safeChat(row.playerName, 80)}</color> foi verificado e considerado <color=#00FF88>LIMPO</color>. <color=#FFD166>Aplicado por:</color> <color=#FF4444>${gameActor(input.actor)}</color>`;
  const gameNotified = await sendGameModerationNotice(notification, input.steamId, "VERIFY");
  return { playerName: row.playerName, roleAssigned: Boolean(roleId), gameNotified };
}

export async function unverifyPlayer(input: { steamId: string; discordUserId?: string; actor: ActionActor }) {
  const row = await player(input.steamId);
  const add = ((adminServer() === "trio" ? process.env.TRIO_VERIFIED_GAME_ADD_CMD : process.env.VERIFIED_GAME_ADD_CMD)?.trim() || "c.usergroup add {steamid} vr").replace(/^oxide\./i, "c.").replace(/\{steam[Ii][Dd]\}/g, input.steamId);
  const remove = ((adminServer() === "trio" ? process.env.TRIO_VERIFIED_GAME_REMOVE_CMD : process.env.VERIFIED_GAME_REMOVE_CMD)?.trim() || "c.usergroup remove {steamid} vr").replace(/^oxide\./i, "c.").replace(/\{steam[Ii][Dd]\}/g, input.steamId);
  await executeRconRequired(remove);
  try {
    if (input.discordUserId && process.env.DISCORD_VERIFIED_ROLE_ID) {
      const member = await memberFor(input.discordUserId);
      if (member.roles.cache.has(process.env.DISCORD_VERIFIED_ROLE_ID)) await member.roles.remove(process.env.DISCORD_VERIFIED_ROLE_ID, `Removido por ${input.actor.name}`);
    }
  } catch {
    await executeRconRequired(add).catch(() => {});
    throw new ActionError("Não foi possível remover o cargo no Discord; a alteração no Rust foi revertida.", 503);
  }
  await db.insert(modLogsTable).values({ serverId: adminServer(), action: "REMOVER_VERIFICADO", steamId: input.steamId, playerName: row?.playerName || input.steamId, reason: input.discordUserId ? `Discord: ${input.discordUserId}` : "Remoção administrativa", adminId: input.actor.id, adminName: input.actor.name });
}

type NetworkBanKind = "ban" | "preventive" | "unban";
type NetworkBanInput = {
  steamId: string; reason: string; actor: ActionActor; playerName?: string;
  duration?: BanDuration; evidenceUrl?: string; skipRcon?: boolean; ipAddresses?: string[];
  association?: { steamId: string; playerName: string };
  expiresAtOverride?: Date | null;
};
const networkBanActions = ["BAN", "PREVENTIVE_BAN", "DESBANIR", "SYSTEM_UNBAN", "BAN_SYNC_PENDING", "UNBAN_SYNC_PENDING"];

async function applyNetworkBanAction(kind: NetworkBanKind, input: NetworkBanInput) {
  if (kind === "unban") return unbanPlayerOnServer(input);
  if (kind === "preventive") return preventiveBanOnServer(input);
  return banPlayerOnServer({ ...input, duration: input.duration || "perm" });
}


const networkBanLocks = new Map<string, Promise<unknown>>();
async function withNetworkBanLock<T>(steamId: string, run: () => Promise<T>): Promise<T> {
  const previous = networkBanLocks.get(steamId) || Promise.resolve();
  const next = previous.catch(() => {}).then(run);
  networkBanLocks.set(steamId, next);
  try { return await next; }
  finally { if (networkBanLocks.get(steamId) === next) networkBanLocks.delete(steamId); }
}

async function networkBanActionUnlocked(kind: NetworkBanKind, input: NetworkBanInput) {
  if (!steamRe.test(input.steamId)) throw new ActionError("SteamID inválido.");
  if (!safe(input.reason)) throw new ActionError("Motivo obrigatório.");
  const origin = adminServer();
  const expiresAt = kind === "ban" && input.duration !== "perm"
    ? new Date(Date.now() + (input.duration === "3d" ? 3 : input.duration === "7d" ? 7 : 30) * 86400000) : null;
  const ipAddresses = kind === "unban" ? [] : await collectPlayerAddresses(input.steamId);
  const shared = { ...input, ipAddresses, reason: safe(input.reason), expiresAtOverride: expiresAt };
  const servers = ["solo-duo", "trio"] as const;
  const outcomes = await Promise.allSettled(servers.map(server => withAdminServer(server, () =>
    applyNetworkBanAction(kind, { ...shared, skipRcon: server === origin && input.skipRcon === true })
  )));
  const failed: string[] = [];
  for (let i = 0; i < servers.length; i++) {
    const outcome = outcomes[i];
    if (outcome.status === "fulfilled") continue;
    const server = servers[i];
    // A preventive ban already confirmed on this server needs no retry.
    if (kind === "preventive" && outcome.reason instanceof ActionError && outcome.reason.status === 409) continue;
    failed.push(server === "trio" ? "Trio" : "Solo/Duo");
    await db.insert(modLogsTable).values({
      serverId: server, action: kind === "unban" ? "UNBAN_SYNC_PENDING" : "BAN_SYNC_PENDING",
      steamId: input.steamId, playerName: safe(input.playerName || input.steamId, 100),
      reason: JSON.stringify({ kind, input: { ...shared, skipRcon: false } }),
      adminId: input.actor.id, adminName: input.actor.name,
      banDuration: input.duration || "perm", banExpiresAt: expiresAt, publicVisible: false,
    });
    logger.error({ error: outcome.reason, server, steamId: input.steamId, kind }, "Network ban action queued for retry");
  }
  if (failed.length) throw new ActionError(
    "Ação ainda não confirmada em " + failed.join(" e ") + ". Os servidores que responderam já foram atualizados; a sincronização pendente será repetida automaticamente.", 503);
  const result = outcomes.find(x => x.status === "fulfilled");
  if (!result || result.status !== "fulfilled") throw new ActionError("Nenhum servidor confirmou a ação.", 503);
  return { ...result.value, gameNotified:outcomes.every(x=>x.status==="fulfilled"&&x.value.gameNotified), ipProtected:kind==="unban"||outcomes.every(x=>x.status==="fulfilled"&&"ipProtected" in x.value&&x.value.ipProtected), servers: [...servers] };
}

async function networkBanAction(kind: NetworkBanKind, input: NetworkBanInput) {
  return withNetworkBanLock(input.steamId, () => networkBanActionUnlocked(kind, input));
}

export async function banPlayer(input: Parameters<typeof banPlayerOnServer>[0]) {
  return networkBanAction("ban", input) as Promise<Awaited<ReturnType<typeof banPlayerOnServer>> & { servers: string[] }>;
}
export async function preventiveBanPlayer(input: Parameters<typeof preventiveBanOnServer>[0]) {
  return networkBanAction("preventive", input) as Promise<Awaited<ReturnType<typeof preventiveBanOnServer>> & { servers: string[] }>;
}
export async function unbanPlayer(input: Parameters<typeof unbanPlayerOnServer>[0]) {
  return networkBanAction("unban", input) as Promise<Awaited<ReturnType<typeof unbanPlayerOnServer>> & { servers: string[] }>;
}

let syncingNetworkBans = false;
export async function syncPendingNetworkBans(): Promise<void> {
  if (syncingNetworkBans) return;
  syncingNetworkBans = true;
  try {
    const pending = await db.select().from(modLogsTable)
      .where(inArray(modLogsTable.action, ["BAN_SYNC_PENDING", "UNBAN_SYNC_PENDING"]))
      .orderBy(desc(modLogsTable.id)).limit(200);
    for (const job of pending) {
      try {
        await withNetworkBanLock(job.steamId, () => withAdminServer(job.serverId === "trio" ? "trio" : "solo-duo", async () => {
          const [latest] = await db.select().from(modLogsTable).where(and(
            eq(modLogsTable.serverId, adminServer()), eq(modLogsTable.steamId, job.steamId),
            inArray(modLogsTable.action, networkBanActions),
          )).orderBy(desc(modLogsTable.id)).limit(1);
          if (latest?.id === job.id) {
            const payload = JSON.parse(job.reason || "{}") as { kind: NetworkBanKind; input: NetworkBanInput };
            if (!["ban", "preventive", "unban"].includes(payload.kind) || payload.input?.steamId !== job.steamId)
              throw new Error("Invalid network ban retry payload");
            const expiresAt = job.banExpiresAt ? new Date(job.banExpiresAt) : null;
            if (payload.kind === "ban" && expiresAt && expiresAt.getTime() <= Date.now()) {
              await unbanPlayerOnServer({ ...payload.input, reason: "Banimento temporário expirado durante sincronização" });
            } else {
              await applyNetworkBanAction(payload.kind, { ...payload.input, skipRcon: false, expiresAtOverride: expiresAt });
            }
          }
          await db.update(modLogsTable).set({ action: "BAN_SYNC_DONE" }).where(eq(modLogsTable.id, job.id));
        }));
      } catch (error) { logger.warn({ error, steamId: job.steamId, server: job.serverId }, "Network ban sync will retry"); }
    }
  } finally { syncingNetworkBans = false; }
}
let networkBanSyncStarted = false;
export function startNetworkBanSync(): void {
  if (networkBanSyncStarted) return;
  networkBanSyncStarted = true;
  void syncPendingNetworkBans().catch(error => logger.error({ error }, "Network ban sync failed"));
  setInterval(() => { void syncPendingNetworkBans().catch(error => logger.error({ error }, "Network ban sync failed")); }, 30_000).unref();
}
