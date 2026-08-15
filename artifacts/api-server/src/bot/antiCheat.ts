import { EmbedBuilder } from "discord.js";
import { db, playerStatsTable, modLogsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { discordClient } from "./client.js";
import { logger } from "../lib/logger.js";

type KillSignal = {
  attackerSteamId: string; attackerName: string; victimSteamId: string; victimName: string;
  headshot: boolean; weapon?: string; distance?: number; timestamp?: number;
};
type HitSignal = KillSignal & { bone?: string };
type RecentKill = KillSignal & { at: number };
type RecentHit = HitSignal & { at: number };
type PlayerState = { recentKills: RecentKill[]; recentArrowHits: RecentHit[]; score: number; lastScoreAt: number; lastAlertAt: number; };

const states = new Map<string, PlayerState>();
const verifiedCache = new Map<string, number>();
const ALERT_COOLDOWN_MS = Number(process.env.ANTICHEAT_ALERT_COOLDOWN_MS || 8 * 60_000);
const HISTORY_MS = 10 * 60_000;
const SCORE_DECAY_MS = Number(process.env.ANTICHEAT_SCORE_DECAY_MS || 2 * 60_000);

function stateFor(steamId: string): PlayerState {
  let state = states.get(steamId);
  if (!state) { state = { recentKills: [], recentArrowHits: [], score: 0, lastScoreAt: Date.now(), lastAlertAt: 0 }; states.set(steamId, state); }
  return state;
}

async function isVerified(steamId: string): Promise<boolean> {
  const now = Date.now();
  const cachedUntil = verifiedCache.get(steamId);
  if (cachedUntil && cachedUntil > now) return true;
  const [row] = await db.select({ id: modLogsTable.id }).from(modLogsTable)
    .where(and(eq(modLogsTable.steamId, steamId), eq(modLogsTable.action, "VERIFICAR"))).limit(1);
  if (row) {
    verifiedCache.set(steamId, now + 10 * 60_000);
    states.delete(steamId);
    return true;
  }
  return false;
}

function normalizeWeapon(raw?: string): string { return (raw ?? "unknown").toLowerCase().replace(/\.entity$|\.prefab$/g, ""); }
function weaponLabel(raw?: string): string {
  const w = normalizeWeapon(raw);
  if (w.includes("nailgun")) return "Arma de Pregos";
  if (w.includes("thompson")) return "Thompson";
  if (w.includes("smg.2") || w.includes("mp5")) return "MP5";
  if (w.includes("customsmg") || w.includes("smg")) return "SMG";
  if (w.includes("python")) return "Python";
  if (w.includes("revolver")) return "Revólver";
  if (w.includes("pistol")) return "Pistola";
  if (w.includes("shotgun") || w.includes("doublebarrel") || w.includes("waterpipe")) return "Shotgun";
  if (w.includes("crossbow")) return "Crossbow";
  if (w.includes("bow")) return "Arco";
  return raw || "Desconhecida";
}

function decayScore(state: PlayerState, now: number): void {
  const elapsed = now - state.lastScoreAt;
  if (elapsed < SCORE_DECAY_MS) return;
  state.score = Math.max(0, state.score - (2 * Math.floor(elapsed / SCORE_DECAY_MS)));
  state.lastScoreAt = now;
}

async function persistentStats(steamId: string) {
  const rows = await db.select({ kills: playerStatsTable.kills, deaths: playerStatsTable.deaths, headshots: playerStatsTable.headshots })
    .from(playerStatsTable).where(eq(playerStatsTable.steamId, steamId));
  const row = rows[0];
  return { kills: Number(row?.kills ?? 0), deaths: Number(row?.deaths ?? 0), headshots: Number(row?.headshots ?? 0) };
}

function levelFor(score: number): { label: string; color: number } {
  if (score >= 16) return { label: "🔴 CRÍTICO", color: 0xe74c3c };
  if (score >= 9) return { label: "🟠 SUSPEITO", color: 0xe67e22 };
  return { label: "🟡 ATENÇÃO", color: 0xf1c40f };
}

async function sendAlert(args: { attackerSteamId: string; attackerName: string; victimName: string; weapon?: string; distance?: number; headshot?: boolean; bone?: string; reasons: string[]; score: number; stats: { kills: number; deaths: number; headshots: number } }) {
  const client = discordClient(); if (!client) return;
  const channelId = process.env.ANTICHEAT_LOG_CHANNEL_ID?.trim() || process.env.DISCORD_LOG_CHANNEL_ID?.trim();
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null); if (!channel?.isSendable()) return;
  const hsRate = args.stats.kills > 0 ? (args.stats.headshots / args.stats.kills) * 100 : 0;
  const level = levelFor(args.score);
  const embed = new EmbedBuilder().setColor(level.color).setTitle(`🛡️ Detector de Suspeita • ${level.label}`)
    .setDescription(`**${args.attackerName}** apresentou padrões que merecem observação.\n\n⚠️ O detector não aplica ban automático.`)
    .addFields(
      { name: "👤 Jogador", value: `${args.attackerName}\n\`${args.attackerSteamId}\``, inline: true },
      { name: "📊 Score", value: `**${args.score}**`, inline: true },
      { name: "🎯 Estatísticas", value: `${args.stats.kills} kills • **${hsRate.toFixed(1)}% HS**`, inline: true },
      { name: "🚨 Motivos", value: args.reasons.map(r => `• ${r}`).join("\n").slice(0, 1024) },
      { name: "🔫 Evento", value: `Vítima: **${args.victimName}**\nArma: **${weaponLabel(args.weapon)}**\nDistância: **${args.distance ? `${args.distance.toFixed(1)}m` : "N/D"}**${args.bone ? `\nLocal: **${args.bone}**` : ""}${typeof args.headshot === "boolean" ? `\nHeadshot: **${args.headshot ? "Sim" : "Não"}**` : ""}` },
      { name: "🔗 Steam", value: `https://steamcommunity.com/profiles/${args.attackerSteamId}` },
    ).setFooter({ text: "Guerra Fria • Alerta para investigação da staff" }).setTimestamp();
  await channel.send({ embeds: [embed] });
}

function distanceRule(w: string, distance: number): { reason: string; points: number } | null {
  if (w.includes("nailgun") && distance >= 35) return { reason: `Arma de Pregos matou a ${distance.toFixed(0)}m`, points: distance >= 50 ? 5 : 3 };
  if ((w.includes("mp5") || w.includes("smg") || w.includes("thompson")) && distance >= 120) return { reason: `${weaponLabel(w)} matou a ${distance.toFixed(0)}m`, points: distance >= 150 ? 5 : 3 };
  if ((w.includes("python") || w.includes("revolver") || w.includes("pistol")) && distance >= 110) return { reason: `${weaponLabel(w)} matou a ${distance.toFixed(0)}m`, points: 3 };
  if ((w.includes("shotgun") || w.includes("doublebarrel") || w.includes("waterpipe")) && distance >= 90) return { reason: `${weaponLabel(w)} matou a ${distance.toFixed(0)}m`, points: 4 };
  if (w.includes("bow") && !w.includes("crossbow") && distance >= 130) return { reason: `Arco matou a ${distance.toFixed(0)}m`, points: 2 };
  if (w.includes("crossbow") && distance >= 160) return { reason: `Crossbow matou a ${distance.toFixed(0)}m`, points: 2 };
  return null;
}

export async function analyzeKill(signal: KillSignal): Promise<void> {
  if (!signal.attackerSteamId.startsWith("7656119") || !signal.victimSteamId.startsWith("7656119") || signal.attackerSteamId === signal.victimSteamId) return;
  if (await isVerified(signal.attackerSteamId)) return;
  const now = signal.timestamp && Number.isFinite(signal.timestamp) ? signal.timestamp : Date.now();
  const state = stateFor(signal.attackerSteamId); decayScore(state, now);
  state.recentKills.push({ ...signal, at: now }); state.recentKills = state.recentKills.filter(k => now - k.at <= HISTORY_MS);
  const reasons: string[] = []; let points = 0;
  const w = normalizeWeapon(signal.weapon); const distance = signal.distance ?? 0;
  const range = distanceRule(w, distance); if (range) { reasons.push(range.reason); points += range.points; }
  if (signal.headshot && range) { reasons.push("Headshot combinado com distância anormal para a arma"); points += 1; }

  const stats = await persistentStats(signal.attackerSteamId).catch(() => ({ kills: 0, deaths: 0, headshots: 0 }));
  const hsRate = stats.kills > 0 ? stats.headshots / stats.kills : 0;
  if (stats.kills >= 30 && hsRate > 0.75) { reasons.push(`HS acima de 75%: ${(hsRate * 100).toFixed(1)}% com ${stats.kills} kills`); points += hsRate >= 0.85 ? 3 : 2; }

  const last3 = state.recentKills.slice(-3);
  if (last3.length === 3 && last3.every(k => k.headshot) && last3[2].at - last3[0].at <= 18_000) { reasons.push("3 kills seguidas de headshot em até 18 segundos"); points += 2; }
  if (last3.length === 3 && last3[2].at - last3[0].at <= 5_000) { reasons.push("3 kills em até 5 segundos"); points += 3; }
  const last4 = state.recentKills.slice(-4);
  if (last4.length === 4 && last4[3].at - last4[0].at <= 10_000) { reasons.push("4 kills em até 10 segundos"); points += 4; }
  const last6 = state.recentKills.slice(-6);
  if (last6.length >= 5 && last6.filter(k => k.headshot).length >= 5 && last6[last6.length - 1]!.at - last6[0]!.at <= 90_000) { reasons.push("5 headshots nas últimas 6 kills em até 90 segundos"); points += 3; }

  const recentSameWeaponLong = state.recentKills.filter(k => normalizeWeapon(k.weapon) === w && (k.distance ?? 0) >= Math.max(80, distance * 0.75)).slice(-3);
  if (range && recentSameWeaponLong.length >= 3) { reasons.push(`3 kills recentes de longa distância com ${weaponLabel(signal.weapon)}`); points += 3; }

  if (!reasons.length) return;
  state.score += points; state.lastScoreAt = now;
  const highConfidence = points >= 5;
  if (state.score < 9 || (reasons.length < 2 && !highConfidence) || now - state.lastAlertAt < ALERT_COOLDOWN_MS) return;
  state.lastAlertAt = now;
  await sendAlert({ ...signal, reasons, score: state.score, stats }).catch(err => logger.error({ err }, "Anti-cheat kill alert failed"));
}

export async function analyzeArrowHit(signal: HitSignal): Promise<void> {
  if (!signal.attackerSteamId.startsWith("7656119") || !signal.victimSteamId.startsWith("7656119") || signal.attackerSteamId === signal.victimSteamId) return;
  if (await isVerified(signal.attackerSteamId)) return;
  const now = signal.timestamp && Number.isFinite(signal.timestamp) ? signal.timestamp : Date.now();
  const state = stateFor(signal.attackerSteamId); decayScore(state, now);
  state.recentArrowHits.push({ ...signal, at: now }); state.recentArrowHits = state.recentArrowHits.filter(h => now - h.at <= 30_000);
  const reasons: string[] = []; let points = 0;
  const sameVictim = state.recentArrowHits.filter(h => h.victimSteamId === signal.victimSteamId);
  const last2 = sameVictim.slice(-2);
  if (last2.length === 2 && last2[1]!.at - last2[0]!.at <= 1500) { reasons.push(`2 flechadas no mesmo jogador em ${((last2[1]!.at - last2[0]!.at) / 1000).toFixed(2)}s`); points += 2; }
  const bone = (signal.bone ?? "unknown").toLowerCase();
  const sameBone = sameVictim.filter(h => (h.bone ?? "unknown").toLowerCase() === bone).slice(-3);
  if (bone !== "unknown" && sameBone.length === 3 && sameBone[2]!.at - sameBone[0]!.at <= 10_000) { reasons.push(`3 flechadas seguidas no mesmo local (${signal.bone}) em até 10s`); points += 3; }
  const last3 = state.recentArrowHits.slice(-3);
  if (last3.length === 3 && last3.every(h => h.headshot) && last3[2]!.at - last3[0]!.at <= 30_000) { reasons.push("3 flechadas consecutivas na cabeça em até 30 segundos"); points += 3; }
  if ((signal.distance ?? 0) >= 150 && signal.headshot) { reasons.push(`Flechada na cabeça a ${(signal.distance ?? 0).toFixed(0)}m`); points += 2; }
  if (!reasons.length) return;
  state.score += points; state.lastScoreAt = now;
  const highConfidence = points >= 5;
  if (state.score < 9 || (reasons.length < 2 && !highConfidence) || now - state.lastAlertAt < ALERT_COOLDOWN_MS) return;
  state.lastAlertAt = now;
  const stats = await persistentStats(signal.attackerSteamId).catch(() => ({ kills: 0, deaths: 0, headshots: 0 }));
  await sendAlert({ ...signal, reasons, score: state.score, stats }).catch(err => logger.error({ err }, "Anti-cheat arrow alert failed"));
}
