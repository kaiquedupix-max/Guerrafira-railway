import { EmbedBuilder } from "discord.js";
import { desc, eq } from "drizzle-orm";
import { db, modLogsTable, playersTable } from "@workspace/db";
import { discordClient } from "../bot/client.js";
import { executeRconCommand } from "../bot/utils/rcon.js";
import { logger } from "../lib/logger.js";

export type ActionSource = "discord" | "web" | "system";
export type ActionActor = { id: string; name: string; source: ActionSource };
export type BanDuration = "3d" | "7d" | "30d" | "perm";
const steamRe = /^7656119\d{10}$/;
const safe = (value: string, max = 300) => String(value ?? "").replace(/[\r\n\t"]/g, " ").trim().slice(0, max);
const safeChat = (value: string, max = 180) => safe(value, max).replace(/[<>]/g, "");

export class ActionError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export async function executeRconRequired(command: string, attempts = 3): Promise<string> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await executeRconCommand(command);
      if (result !== null) return result;
      last = new Error("RCON retornou sem confirmação");
    } catch (error) { last = error; }
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 600));
  }
  logger.error({ err: last, command: command.split(" ")[0], attempts }, "Critical RCON action failed");
  throw new ActionError("Servidor Rust indisponível. Nenhuma alteração foi registrada.", 503);
}

async function player(steamId: string) {
  if (!steamRe.test(steamId)) throw new ActionError("SteamID inválido.");
  const [row] = await db.select().from(playersTable).where(eq(playersTable.steamId, steamId)).limit(1);
  return row;
}

async function log(embed: EmbedBuilder) {
  const client = discordClient(), channelId = process.env.DISCORD_LOG_CHANNEL_ID;
  if (!client || !channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel?.isSendable()) await channel.send({ embeds: [embed] }).catch(error => logger.error({ error }, "Moderation log delivery failed"));
}

const actorLabel = (actor: ActionActor) => actor.source === "web" ? `<@${actor.id}> • Painel Web` : actor.source === "system" ? actor.name : `<@${actor.id}>`;
const gameActor = (actor: ActionActor) => safeChat(actor.name, 60);

async function sendGameModerationNotice(command: string, steamId: string, type: string): Promise<boolean> {
  return executeRconRequired(command).then(() => true).catch(error => {
    logger.error({ error, steamId, type }, "In-game moderation notification failed");
    return false;
  });
}

export async function banPlayer(input: { steamId: string; duration: BanDuration; reason: string; actor: ActionActor; playerName?: string }) {
  const row = await player(input.steamId);
  const name = safe(input.playerName || row?.playerName || `Jogador offline (${input.steamId})`, 100);
  const reason = safe(input.reason);
  if (!reason) throw new ActionError("Motivo obrigatório.");
  const days = input.duration === "3d" ? 3 : input.duration === "7d" ? 7 : input.duration === "30d" ? 30 : 0;
  const expiresAt = days ? new Date(Date.now() + days * 86400000) : null;
  await executeRconRequired(`banid ${input.steamId} "${name}" "[${input.duration.toUpperCase()}] ${reason} | Recurso: discord.gg/guerrafria"`);
  await db.insert(modLogsTable).values({ action: "BAN", steamId: input.steamId, playerName: name, reason, adminId: input.actor.id, adminName: input.actor.name, banDuration: input.duration, banExpiresAt: expiresAt });
  await log(new EmbedBuilder().setColor(0xe74c3c).setTitle("🔨 Banimento aplicado").addFields(
    { name: "Jogador", value: name, inline: true }, { name: "SteamID", value: `\`${input.steamId}\``, inline: true },
    { name: "Duração", value: input.duration, inline: true }, { name: "Motivo", value: reason }, { name: "Responsável", value: actorLabel(input.actor) }
  ).setFooter({ text: "Guerra Fria • Moderação" }).setTimestamp());
  const gameNotified = await sendGameModerationNotice(
    `say <color=#FF4444>[JOGADOR BANIDO]</color> | <color=#FF8800>${safeChat(name, 80)}</color> foi banido. <color=#FFD166>Aplicado por:</color> <color=#FF4444>${gameActor(input.actor)}</color> | <color=#FFD166>Motivo:</color> <color=#FFFFFF>${safeChat(reason, 160)}</color>`,
    input.steamId, "BAN");
  return { playerName: name, expiresAt, gameNotified };
}

export async function preventiveBanPlayer(input: { steamId: string; reason: string; actor: ActionActor; playerName?: string }) {
  const current = await activeBan(input.steamId);
  if (current) throw new ActionError("Este jogador já possui um banimento ativo.", 409);
  const row = await player(input.steamId);
  const name = safe(input.playerName || row?.playerName || `Jogador offline (${input.steamId})`, 100);
  const reason = safe(input.reason);
  if (!reason) throw new ActionError("Motivo obrigatório.");
  const connectionMessage = `[BANIMENTO PREVENTIVO] Motivo: ${reason} | Para liberacao: entre em discord.gg/guerrafria e abra um ticket para VERIFICACAO.`;
  await executeRconRequired(`banid ${input.steamId} "${name}" "${connectionMessage}"`);
  await db.insert(modLogsTable).values({ action: "PREVENTIVE_BAN", steamId: input.steamId, playerName: name, reason, adminId: input.actor.id, adminName: input.actor.name, banDuration: "perm", banExpiresAt: null });
  await log(new EmbedBuilder().setColor(0xf59e0b).setTitle("🛡️ Banimento preventivo aplicado").setDescription(
    "O jogador foi bloqueado preventivamente e deverá passar por **verificação administrativa** antes de retornar ao servidor."
  ).addFields(
    { name: "Jogador", value: name, inline: true }, { name: "SteamID", value: `\`${input.steamId}\``, inline: true },
    { name: "Status", value: "Preventivo • até revisão", inline: true }, { name: "Motivo", value: reason },
    { name: "Próximo passo", value: "Entrar em **discord.gg/guerrafria** e abrir um ticket para **VERIFICAÇÃO**." }, { name: "Responsável", value: actorLabel(input.actor) }
  ).setFooter({ text: "Guerra Fria • Moderação Preventiva" }).setTimestamp());
  const gameNotified = await sendGameModerationNotice(
    `say <color=#FFB000>[BANIMENTO PREVENTIVO]</color> | <color=#FF8800>${safeChat(name, 80)}</color> foi banido preventivamente. <color=#FFD166>Aplicado por:</color> <color=#FF4444>${gameActor(input.actor)}</color> | <color=#FFD166>Motivo:</color> <color=#FFFFFF>${safeChat(reason, 130)}</color> | <color=#00FF88>Para ser desbanido, entre em discord.gg/guerrafria e abra um ticket para VERIFICAÇÃO.</color>`,
    input.steamId, "PREVENTIVE_BAN");
  return { playerName: name, expiresAt: null, gameNotified, preventive: true };
}

export async function kickPlayer(input: { steamId: string; reason: string; actor: ActionActor }) {
  const row = await player(input.steamId);
  if (!row?.isOnline) throw new ActionError("Jogador offline ou não encontrado.", 409);
  const reason = safe(input.reason); if (!reason) throw new ActionError("Motivo obrigatório.");
  await executeRconRequired(`kick "${safe(row.playerName, 100)}" "${reason} | Recurso: discord.gg/guerrafria"`);
  await db.insert(modLogsTable).values({ action: "KICK", steamId: row.steamId, playerName: row.playerName, reason, adminId: input.actor.id, adminName: input.actor.name });
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
  const rows = await db.select().from(modLogsTable).where(eq(modLogsTable.steamId, steamId)).orderBy(desc(modLogsTable.createdAt)).limit(100);
  const state = rows.find(x => x.action === "BAN" || x.action === "PREVENTIVE_BAN" || x.action === "DESBANIR" || x.action === "SYSTEM_UNBAN");
  return state?.action === "BAN" || state?.action === "PREVENTIVE_BAN" ? state : null;
}

export async function unbanPlayer(input: { steamId: string; reason: string; actor: ActionActor }) {
  const ban = await activeBan(input.steamId);
  if (!ban) throw new ActionError("Este jogador não possui banimento ativo.", 409);
  const reason = safe(input.reason); if (!reason) throw new ActionError("Motivo obrigatório.");
  await executeRconRequired(`unban ${input.steamId}`);
  await db.insert(modLogsTable).values({ action: "DESBANIR", steamId: input.steamId, playerName: ban.playerName, reason, adminId: input.actor.id, adminName: input.actor.name });
  await log(new EmbedBuilder().setColor(0x22c55e).setTitle("✅ Jogador desbanido").addFields(
    { name: "Jogador", value: ban.playerName, inline: true }, { name: "SteamID", value: `\`${input.steamId}\``, inline: true },
    { name: "Tipo anterior", value: ban.action === "PREVENTIVE_BAN" ? "Banimento preventivo" : "Banimento", inline: true },
    { name: "Motivo", value: reason }, { name: "Responsável", value: actorLabel(input.actor) }
  ).setFooter({ text: "Guerra Fria • Moderação" }).setTimestamp());
  const gameNotified = await sendGameModerationNotice(
    `say <color=#00FF88>[JOGADOR DESBANIDO]</color> | <color=#FF8800>${safeChat(ban.playerName, 80)}</color> foi desbanido. <color=#FFD166>Aplicado por:</color> <color=#FF4444>${gameActor(input.actor)}</color> | <color=#FFD166>Motivo:</color> <color=#FFFFFF>${safeChat(reason, 160)}</color>`,
    input.steamId, "UNBAN");
  return { playerName: ban.playerName, previousType: ban.action, gameNotified };
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
  const add = (process.env.VERIFIED_GAME_ADD_CMD?.trim() || "c.usergroup add {steamid} vr").replace(/^oxide\./i, "c.").replace(/\{steam[Ii][Dd]\}/g, input.steamId);
  const remove = (process.env.VERIFIED_GAME_REMOVE_CMD?.trim() || "c.usergroup remove {steamid} vr").replace(/^oxide\./i, "c.").replace(/\{steam[Ii][Dd]\}/g, input.steamId);
  await executeRconRequired(add);
  try {
    if (roleId && !member.roles.cache.has(roleId)) await member.roles.add(roleId, `Verificado por ${input.actor.name}`);
  } catch (error) {
    await executeRconRequired(remove).catch(() => {});
    throw new ActionError("Não foi possível atribuir o cargo no Discord; a alteração no Rust foi revertida.", 503);
  }
  await db.insert(modLogsTable).values({ action: "VERIFICAR", steamId: input.steamId, playerName: row.playerName, reason: `Triagem concluída — Discord: ${member.user.tag}`, adminId: input.actor.id, adminName: input.actor.name });
  await log(new EmbedBuilder().setColor(0x22c55e).setTitle("🛡️ Jogador verificado").addFields(
    { name: "Jogador", value: row.playerName, inline: true }, { name: "SteamID", value: `\`${input.steamId}\``, inline: true },
    { name: "Discord", value: `<@${input.discordUserId}>`, inline: true }, { name: "Responsável", value: actorLabel(input.actor) }
  ).setFooter({ text: "Guerra Fria • Verificação" }).setTimestamp());
  const notification = `say <color=#00FF88>[VERIFICAÇÃO CONCLUÍDA]</color> | <color=#FF8800>${safeChat(row.playerName, 80)}</color> foi verificado e considerado <color=#00FF88>LIMPO</color>. <color=#FFD166>Aplicado por:</color> <color=#FF4444>${gameActor(input.actor)}</color>`;
  const gameNotified = await sendGameModerationNotice(notification, input.steamId, "VERIFY");
  return { playerName: row.playerName, roleAssigned: Boolean(roleId), gameNotified };
}

export async function unverifyPlayer(input: { steamId: string; discordUserId?: string; actor: ActionActor }) {
  const row = await player(input.steamId);
  const add = (process.env.VERIFIED_GAME_ADD_CMD?.trim() || "c.usergroup add {steamid} vr").replace(/^oxide\./i, "c.").replace(/\{steam[Ii][Dd]\}/g, input.steamId);
  const remove = (process.env.VERIFIED_GAME_REMOVE_CMD?.trim() || "c.usergroup remove {steamid} vr").replace(/^oxide\./i, "c.").replace(/\{steam[Ii][Dd]\}/g, input.steamId);
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
  await db.insert(modLogsTable).values({ action: "REMOVER_VERIFICADO", steamId: input.steamId, playerName: row?.playerName || input.steamId, reason: input.discordUserId ? `Discord: ${input.discordUserId}` : "Remoção administrativa", adminId: input.actor.id, adminName: input.actor.name });
}
