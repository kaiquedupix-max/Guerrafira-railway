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

type HitSignal = KillSignal & { bone?: string };
type RecentKill = KillSignal & { at: number };
type RecentHit = HitSignal & { at: number };

type PlayerState = {
  recentKills: RecentKill[];
  recentArrowHits: RecentHit[];
  score: number;
  lastScoreAt: number;
  lastAlertAt: number;
};

const states = new Map<string, PlayerState>();
const ALERT_COOLDOWN_MS = 60_000;
const HISTORY_MS = 10 * 60_000;
const SCORE_DECAY_MS = 3 * 60_000;

function stateFor(steamId: string): PlayerState {
  let state = states.get(steamId);
  if (!state) {
    state = { recentKills: [], recentArrowHits: [], score: 0, lastScoreAt: Date.now(), lastAlertAt: 0 };
    states.set(steamId, state);
  }
  return state;
}

function normalizeWeapon(raw?: string): string {
  return (raw ?? "unknown").toLowerCase().replace(/\.entity$|\.prefab$/g, "");
}

function weaponLabel(raw?: string): string {
  const w = normalizeWeapon(raw);
  if (w.includes("thompson")) return "Thompson";
  if (w.includes("smg.2") || w.includes("mp5")) return "MP5";
  if (w.includes("smg")) return "SMG";
  if (w.includes("crossbow")) return "Crossbow";
  if (w.includes("bow")) return "Arco";
  return raw || "Desconhecida";
}

function decayScore(state: PlayerState, now: number): void {
  const elapsed = now - state.lastScoreAt;
  if (elapsed < SCORE_DECAY_MS) return;
  state.score = Math.max(0, state.score - Math.floor(elapsed / SCORE_DECAY_MS));
  state.lastScoreAt = now;
}

async function persistentStats(steamId: string): Promise<{ kills: number; deaths: number; headshots: number }> {
  const rows = await db.select({ kills: playerStatsTable.kills, deaths: playerStatsTable.deaths, headshots: playerStatsTable.headshots })
    .from(playerStatsTable).where(eq(playerStatsTable.steamId, steamId));
  const row = rows[0];
  return { kills: Number(row?.kills ?? 0), deaths: Number(row?.deaths ?? 0), headshots: Number(row?.headshots ?? 0) };
}

function levelFor(score: number): { label: string; color: number } {
  if (score >= 6) return { label: "🔴 CRÍTICO", color: 0xe74c3c };
  if (score >= 3) return { label: "🟠 SUSPEITO", color: 0xe67e22 };
  return { label: "🟡 ATENÇÃO", color: 0xf1c40f };
}

async function sendAlert(args: {
  attackerSteamId: string;
  attackerName: string;
  victimName: string;
  weapon?: string;
  distance?: number;
  headshot?: boolean;
  bone?: string;
  reasons: string[];
  score: number;
  stats: { kills: number; deaths: number; headshots: number };
}): Promise<void> {
  const client = discordClient();
  if (!client) return;
  const channelId = process.env.ANTICHEAT_LOG_CHANNEL_ID?.trim() || process.env.DISCORD_LOG_CHANNEL_ID?.trim();
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return;

  const hsRate = args.stats.kills > 0 ? (args.stats.headshots / args.stats.kills) * 100 : 0;
  const level = levelFor(args.score);
  const embed = new EmbedBuilder()
    .setColor(level.color)
    .setTitle(`🛡️ Detector de Suspeita • ${level.label}`)
    .setDescription(`**${args.attackerName}** gerou um comportamento que merece observação.\n\n⚠️ Alerta assistido: não aplica ban automático.`)
    .addFields(
      { name: "👤 Jogador", value: `${args.attackerName}\n\`${args.attackerSteamId}\``, inline: true },
      { name: "📊 Score", value: `**${args.score}**`, inline: true },
      { name: "🎯 HS", value: `${args.stats.kills} kills • **${hsRate.toFixed(1)}% HS**`, inline: true },
      { name: "🚨 Motivos", value: args.reasons.map(r => `• ${r}`).join("\n").slice(0, 1024) },
      { name: "🔫 Evento", value: `Vítima: **${args.victimName}**\nArma: **${weaponLabel(args.weapon)}**\nDistância: **${args.distance ? `${args.distance.toFixed(1)}m` : "N/D"}**${args.bone ? `\nLocal: **${args.bone}**` : ""}${typeof args.headshot === "boolean" ? `\nHeadshot: **${args.headshot ? "Sim" : "Não"}**` : ""}` },
      { name: "🔗 Steam", value: `https://steamcommunity.com/profiles/${args.attackerSteamId}` },
    )
    .setFooter({ text: "Guerra Fria • Observar manualmente antes de qualquer punição" })
    .setTimestamp();
  await channel.send({ embeds: [embed] });
}

export async function analyzeKill(signal: KillSignal): Promise<void> {
  if (!signal.attackerSteamId.startsWith("7656119") || !signal.victimSteamId.startsWith("7656119") || signal.attackerSteamId === signal.victimSteamId) return;
  const now = signal.timestamp && Number.isFinite(signal.timestamp) ? signal.timestamp : Date.now();
  const state = stateFor(signal.attackerSteamId);
  decayScore(state, now);
  state.recentKills.push({ ...signal, at: now });
  state.recentKills = state.recentKills.filter(k => now - k.at <= HISTORY_MS);

  const reasons: string[] = [];
  let points = 0;
  const w = normalizeWeapon(signal.weapon);

  if ((w.includes("mp5") || w.includes("smg") || w.includes("thompson")) && (signal.distance ?? 0) >= 120) {
    reasons.push(`${weaponLabel(signal.weapon)} matou a ${(signal.distance ?? 0).toFixed(0)}m`);
    points += 3;
  }

  const stats = await persistentStats(signal.attackerSteamId).catch(() => ({ kills: 0, deaths: 0, headshots: 0 }));
  const hsRate = stats.kills > 0 ? stats.headshots / stats.kills : 0;
  if (stats.kills >= 10 && hsRate > 0.60) {
    reasons.push(`HS acima de 60%: ${(hsRate * 100).toFixed(1)}% com ${stats.kills} kills`);
    points += 2;
  }

  const last3 = state.recentKills.slice(-3);
  if (last3.length === 3 && last3.every(k => k.headshot) && last3[2].at - last3[0].at <= 30_000) {
    reasons.push("3 kills seguidas de headshot em até 30 segundos");
    points += 2;
  }

  if (!reasons.length) return;
  state.score += points;
  state.lastScoreAt = now;
  if (now - state.lastAlertAt < ALERT_COOLDOWN_MS) return;
  state.lastAlertAt = now;
  await sendAlert({ ...signal, reasons, score: state.score, stats }).catch(err => logger.error({ err }, "Anti-cheat kill alert failed"));
}

export async function analyzeArrowHit(signal: HitSignal): Promise<void> {
  if (!signal.attackerSteamId.startsWith("7656119") || !signal.victimSteamId.startsWith("7656119") || signal.attackerSteamId === signal.victimSteamId) return;
  const now = signal.timestamp && Number.isFinite(signal.timestamp) ? signal.timestamp : Date.now();
  const state = stateFor(signal.attackerSteamId);
  decayScore(state, now);
  state.recentArrowHits.push({ ...signal, at: now });
  state.recentArrowHits = state.recentArrowHits.filter(h => now - h.at <= 15_000);

  const reasons: string[] = [];
  let points = 0;
  const sameVictim = state.recentArrowHits.filter(h => h.victimSteamId === signal.victimSteamId);
  const last2 = sameVictim.slice(-2);
  if (last2.length === 2 && last2[1].at - last2[0].at <= 1500) {
    reasons.push(`2 flechadas no mesmo jogador em ${(last2[1].at - last2[0].at) / 1000}s`);
    points += 2;
  }

  const bone = (signal.bone ?? "unknown").toLowerCase();
  const sameBone = sameVictim.filter(h => (h.bone ?? "unknown").toLowerCase() === bone).slice(-3);
  if (bone !== "unknown" && sameBone.length === 3 && sameBone[2].at - sameBone[0].at <= 10_000) {
    reasons.push(`3 flechadas seguidas no mesmo local (${signal.bone}) em até 10s`);
    points += 3;
  }

  if (!reasons.length) return;
  state.score += points;
  state.lastScoreAt = now;
  if (now - state.lastAlertAt < ALERT_COOLDOWN_MS) return;
  state.lastAlertAt = now;
  const stats = await persistentStats(signal.attackerSteamId).catch(() => ({ kills: 0, deaths: 0, headshots: 0 }));
  await sendAlert({ ...signal, reasons, score: state.score, stats }).catch(err => logger.error({ err }, "Anti-cheat arrow alert failed"));
}
