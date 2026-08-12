import { EmbedBuilder } from "discord.js";
import { db, playerStatsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { discordClient } from "./client.js";
import { logger } from "../lib/logger.js";

type KillSignal = {
  attackerSteamId: string;
  attackerName: string;
  victimSteamId: string;
  victimName: string;
  headshot: boolean;
  weapon?: string;
  distance?: number;
  timestamp?: number;
};

type RecentKill = KillSignal & { at: number };

type PlayerState = {
  recent: RecentKill[];
  score: number;
  lastScoreAt: number;
  lastAlertAt: number;
  headshotStreak: number;
  killStreak: number;
  lastVictimIds: string[];
};

const states = new Map<string, PlayerState>();
const ALERT_COOLDOWN_MS = 90_000;
const HISTORY_MS = 15 * 60_000;
const SCORE_DECAY_MS = 5 * 60_000;

function stateFor(steamId: string): PlayerState {
  let state = states.get(steamId);
  if (!state) {
    state = { recent: [], score: 0, lastScoreAt: Date.now(), lastAlertAt: 0, headshotStreak: 0, killStreak: 0, lastVictimIds: [] };
    states.set(steamId, state);
  }
  return state;
}

function normalizeWeapon(raw?: string): string {
  return (raw ?? "desconhecida").toLowerCase().replace(/\.entity$|\.prefab$/g, "");
}

function weaponLabel(raw?: string): string {
  const w = normalizeWeapon(raw);
  if (w.includes("thompson")) return "Thompson";
  if (w.includes("smg.2") || w.includes("mp5")) return "MP5";
  if (w.includes("smg")) return "SMG";
  if (w.includes("pistol.python")) return "Python";
  if (w.includes("pistol.revolver")) return "Revolver";
  if (w.includes("pistol.semiauto")) return "P250/SAP";
  if (w.includes("pistol")) return "Pistola";
  if (w.includes("rifle.ak")) return "AK";
  if (w.includes("rifle.lr300")) return "LR-300";
  if (w.includes("rifle.bolt")) return "Bolt";
  if (w.includes("rifle.l96")) return "L96";
  if (w.includes("shotgun")) return "Shotgun";
  return raw || "Desconhecida";
}

function addReason(reasons: string[], points: { value: number }, reason: string, score: number): void {
  if (!reasons.includes(reason)) reasons.push(reason);
  points.value += score;
}

function evaluateWeaponDistance(weaponRaw: string | undefined, distance: number | undefined, reasons: string[], points: { value: number }): void {
  if (!distance || distance <= 0) return;
  const w = normalizeWeapon(weaponRaw);

  if (w.includes("thompson") && distance >= 200) addReason(reasons, points, `Thompson a ${distance.toFixed(0)}m`, 5);
  else if ((w.includes("smg") || w.includes("mp5")) && distance >= 180) addReason(reasons, points, `${weaponLabel(weaponRaw)} a ${distance.toFixed(0)}m`, 4);
  else if ((w.includes("pistol") || w.includes("python") || w.includes("revolver")) && distance >= 150) addReason(reasons, points, `${weaponLabel(weaponRaw)} a ${distance.toFixed(0)}m`, 4);
  else if (w.includes("shotgun") && distance >= 140) addReason(reasons, points, `Shotgun a ${distance.toFixed(0)}m`, 4);
}

function decayScore(state: PlayerState, now: number): void {
  const elapsed = now - state.lastScoreAt;
  if (elapsed < SCORE_DECAY_MS) return;
  const decay = Math.floor(elapsed / SCORE_DECAY_MS);
  state.score = Math.max(0, state.score - decay);
  state.lastScoreAt = now;
}

async function persistentStats(steamId: string): Promise<{ kills: number; deaths: number; headshots: number }> {
  const rows = await db.select({ kills: playerStatsTable.kills, deaths: playerStatsTable.deaths, headshots: playerStatsTable.headshots })
    .from(playerStatsTable)
    .where(eq(playerStatsTable.steamId, steamId));
  const row = rows[0];
  return { kills: Number(row?.kills ?? 0), deaths: Number(row?.deaths ?? 0), headshots: Number(row?.headshots ?? 0) };
}

async function sendAlert(signal: KillSignal, reasons: string[], score: number, stats: { kills: number; deaths: number; headshots: number }, recent: RecentKill[]): Promise<void> {
  const client = discordClient();
  if (!client) return;
  const channelId = process.env.ANTICHEAT_LOG_CHANNEL_ID?.trim() || process.env.DISCORD_LOG_CHANNEL_ID?.trim();
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return;

  const hsRate = stats.kills > 0 ? (stats.headshots / stats.kills) * 100 : 0;
  const kd = stats.deaths > 0 ? stats.kills / stats.deaths : stats.kills;
  const level = score >= 10 ? "🔴 CRÍTICO" : score >= 6 ? "🟠 SUSPEITO" : "🟡 ATENÇÃO";
  const color = score >= 10 ? 0xe74c3c : score >= 6 ? 0xe67e22 : 0xf1c40f;
  const lastKills = recent.slice(-5).map((k) => `• ${k.headshot ? "🎯 HS" : "💀 Kill"} em **${k.victimName}** — ${weaponLabel(k.weapon)}${k.distance ? ` • ${k.distance.toFixed(0)}m` : ""}`).join("\n");

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🛡️ Anti-Cheat • ${level}`)
    .setDescription(`**${signal.attackerName}** gerou sinais que merecem observação da staff.\n\n⚠️ **Isto não é prova de cheat e não aplica punição automática.**`)
    .addFields(
      { name: "👤 Jogador", value: `${signal.attackerName}\n\`${signal.attackerSteamId}\``, inline: true },
      { name: "📊 Score", value: `**${score} pontos**`, inline: true },
      { name: "🎯 Estatísticas", value: `Kills: **${stats.kills}**\nK/D: **${kd.toFixed(2)}**\nHS: **${hsRate.toFixed(1)}%**`, inline: true },
      { name: "🚨 Motivos", value: reasons.map((r) => `• ${r}`).join("\n").slice(0, 1024) },
      { name: "🔫 Último evento", value: `Vítima: **${signal.victimName}**\nArma: **${weaponLabel(signal.weapon)}**\nDistância: **${signal.distance ? `${signal.distance.toFixed(1)}m` : "N/D"}**\nHeadshot: **${signal.headshot ? "Sim" : "Não"}**`, inline: true },
      { name: "🧾 Sequência recente", value: lastKills || "Sem sequência registrada", inline: false },
      { name: "🔗 Steam", value: `https://steamcommunity.com/profiles/${signal.attackerSteamId}` },
    )
    .setFooter({ text: "Guerra Fria • Detecção assistida — revisar manualmente antes de qualquer punição" })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

export async function analyzeKill(signal: KillSignal): Promise<void> {
  if (!signal.attackerSteamId.startsWith("7656119") || !signal.victimSteamId.startsWith("7656119")) return;
  if (signal.attackerSteamId === signal.victimSteamId) return;

  const now = signal.timestamp && Number.isFinite(signal.timestamp) ? signal.timestamp : Date.now();
  const state = stateFor(signal.attackerSteamId);
  decayScore(state, now);

  state.recent.push({ ...signal, at: now });
  state.recent = state.recent.filter((k) => now - k.at <= HISTORY_MS);
  state.killStreak += 1;
  state.headshotStreak = signal.headshot ? state.headshotStreak + 1 : 0;
  state.lastVictimIds.push(signal.victimSteamId);
  state.lastVictimIds = state.lastVictimIds.slice(-10);

  const reasons: string[] = [];
  const points = { value: 0 };

  const last30 = state.recent.filter((k) => now - k.at <= 30_000);
  const last20 = state.recent.filter((k) => now - k.at <= 20_000);
  const last10 = state.recent.filter((k) => now - k.at <= 10_000);
  const last8 = state.recent.filter((k) => now - k.at <= 8_000);
  const last4 = state.recent.filter((k) => now - k.at <= 4_000);

  if (state.headshotStreak >= 5) addReason(reasons, points, `${state.headshotStreak} kills consecutivas, todas de headshot`, 5);
  else if (state.headshotStreak >= 3 && last10.filter((k) => k.headshot).length >= 3) addReason(reasons, points, `${state.headshotStreak} headshots consecutivos em poucos segundos`, 3);

  if (last20.length >= 4) addReason(reasons, points, `${last20.length} kills em menos de 20 segundos`, 3);
  if (last30.length >= 5) addReason(reasons, points, `${last30.length} kills em menos de 30 segundos`, 4);

  const targets4 = new Set(last4.map((k) => k.victimSteamId)).size;
  const targets8 = new Set(last8.map((k) => k.victimSteamId)).size;
  if (targets4 >= 3) addReason(reasons, points, `${targets4} vítimas diferentes em até 4 segundos (possível snap)`, 4);
  if (targets8 >= 4) addReason(reasons, points, `${targets8} vítimas diferentes em até 8 segundos`, 4);

  evaluateWeaponDistance(signal.weapon, signal.distance, reasons, points);

  const stats = await persistentStats(signal.attackerSteamId).catch(() => ({ kills: 0, deaths: 0, headshots: 0 }));
  const projectedKills = Math.max(stats.kills, 1);
  const hsRate = stats.headshots / projectedKills;
  if (stats.kills >= 20 && hsRate >= 0.85) addReason(reasons, points, `HS% extremamente alto: ${(hsRate * 100).toFixed(1)}% em ${stats.kills} kills`, 4);
  else if (stats.kills >= 15 && hsRate >= 0.80) addReason(reasons, points, `HS% muito alto: ${(hsRate * 100).toFixed(1)}% em ${stats.kills} kills`, 3);

  if (stats.kills >= 15 && stats.deaths <= 1) addReason(reasons, points, `K/D fora do padrão: ${stats.kills}/${stats.deaths}`, 3);

  const recentLongRange = state.recent.filter((k) => {
    if (!k.distance || k.distance < 150) return false;
    const w = normalizeWeapon(k.weapon);
    return w.includes("thompson") || w.includes("smg") || w.includes("pistol") || w.includes("revolver") || w.includes("python");
  });
  if (recentLongRange.length >= 3) addReason(reasons, points, `${recentLongRange.length} kills recentes de longa distância com arma de curto/médio alcance`, 4);

  if (!reasons.length) return;

  state.score += points.value;
  state.lastScoreAt = now;
  const criticalSingle = points.value >= 5;
  const shouldAlert = (state.score >= 6 || criticalSingle) && now - state.lastAlertAt >= ALERT_COOLDOWN_MS;
  if (!shouldAlert) return;

  state.lastAlertAt = now;
  await sendAlert(signal, reasons, state.score, stats, state.recent).catch((err) => logger.error({ err, steamId: signal.attackerSteamId }, "Anti-cheat Discord alert failed"));
  logger.warn({ steamId: signal.attackerSteamId, player: signal.attackerName, score: state.score, reasons }, "Anti-cheat suspicion detected");
}
