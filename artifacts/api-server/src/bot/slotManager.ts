/**
 * Automatic slot manager + bot presence updater.
 *
 * Rules:
 *  • Min slots : MIN_SLOTS  (default 100)
 *  • Max slots : MAX_SLOTS  (default 250)
 *  • Step      : 10 slots per tick
 *  • Scale UP  : queued > 0 OR players >= currentSlots  → +10 (up to max)
 *  • Scale DOWN: queued = 0 AND players ≤ currentSlots - 10 AND currentSlots > min → -10
 *  • Presence  : "Jogando Guerra Fria 2X | players/currentSlots"
 *  • Runs every 60 s (piggyback on status updater interval)
 */

import { ActivityType, type Client } from "discord.js";
import { getServerInfo, executeRconCommand } from "./utils/rcon.js";
import { logger } from "../lib/logger.js";

const MIN_SLOTS = parseInt(process.env.SERVER_MIN_SLOTS ?? "100", 10);
const MAX_SLOTS = parseInt(process.env.SERVER_MAX_SLOTS ?? "250", 10);
const STEP      = 10;
const INTERVAL  = 60_000;

// Persists across ticks — initialised from the real server value on first run
let currentSlots: number | null = null;

function clamp(n: number): number {
  return Math.max(MIN_SLOTS, Math.min(MAX_SLOTS, n));
}

async function setSlots(newSlots: number): Promise<boolean> {
  const result = await executeRconCommand(`server.maxplayers ${newSlots}`);
  if (result === null) {
    logger.warn({ newSlots }, "Slot change RCON command failed (connection issue)");
    return false;
  }
  logger.info({ from: currentSlots, to: newSlots }, "Server slots updated via RCON");
  currentSlots = newSlots;
  return true;
}

function updatePresence(client: Client, players: number, slots: number): void {
  if (!client.user) return;
  client.user.setPresence({
    activities: [{
      name: `🎮 Guerra Fria 2X | 👥 ${players}/${slots} jogadores online`,
      type: ActivityType.Playing,
    }],
    status: "online",
  });
}

export function startSlotManager(client: Client): void {
  async function tick() {
    const info = await getServerInfo();
    if (!info) return;

    const { players, queued } = info;

    // On first tick: sync currentSlots from the real server value
    if (currentSlots === null) {
      currentSlots = clamp(info.maxPlayers || MIN_SLOTS);
      logger.info({ currentSlots }, "Slot manager initialised from server");
    }

    const prevSlots = currentSlots;

    // ── Scale UP ──────────────────────────────────────────────────────────────
    if ((queued > 0 || players >= currentSlots) && currentSlots < MAX_SLOTS) {
      const target = clamp(currentSlots + STEP);
      const ok = await setSlots(target);
      if (ok) {
        logger.info(
          { players, queued, from: prevSlots, to: currentSlots },
          `↑ Queue/full detected — slots expanded to ${currentSlots}`,
        );
      }

    // ── Scale DOWN ────────────────────────────────────────────────────────────
    } else if (queued === 0 && currentSlots > MIN_SLOTS && players <= currentSlots - STEP) {
      const target = clamp(currentSlots - STEP);
      // Safety: never reduce below current player count
      if (target >= players) {
        const ok = await setSlots(target);
        if (ok) {
          logger.info(
            { players, from: prevSlots, to: currentSlots },
            `↓ No queue, players low — slots reduced to ${currentSlots}`,
          );
        }
      }
    }

    // ── Presence ──────────────────────────────────────────────────────────────
    updatePresence(client, players, currentSlots);
  }

  // First run after 10 s to let RCON stabilise
  setTimeout(() => tick().catch((err) => logger.error({ err }, "Slot manager tick error")), 10_000);
  setInterval(() => tick().catch((err) => logger.error({ err }, "Slot manager tick error")), INTERVAL);

  logger.info({ MIN_SLOTS, MAX_SLOTS, STEP }, "Slot manager started");
}
