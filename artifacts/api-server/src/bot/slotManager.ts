/**
 * Guerra Fria slot manager.
 *
 * Railway variables remain the defaults:
 *   SERVER_MIN_SLOTS (default 100)
 *   SERVER_MAX_SLOTS (default 250)
 *
 * Runtime settings are persisted in PostgreSQL so the admin panel can switch
 * between automatic and manual modes without a deploy.
 */
import { ActivityType, type Client } from "discord.js";
import { pool } from "@workspace/db";
import { getServerInfo, executeRconCommand } from "./utils/rcon.js";
import { logger } from "../lib/logger.js";

const DEFAULT_MIN_SLOTS = Math.max(1, parseInt(process.env.SERVER_MIN_SLOTS ?? "100", 10) || 100);
const DEFAULT_MAX_SLOTS = Math.max(DEFAULT_MIN_SLOTS, parseInt(process.env.SERVER_MAX_SLOTS ?? "250", 10) || 250);
const STEP = 10;
const INTERVAL = 15_000;
const SHRINK_HOLD_MS = 5 * 60_000;
const HARD_MAX = 1000;

export type SlotControlMode = "automatic" | "manual";
export interface SlotControlSettings {
  mode: SlotControlMode;
  minSlots: number;
  maxSlots: number;
  manualSlots: number;
  currentSlots: number | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

let currentSlots: number | null = null;
let lastExpansionAt = 0;
let tableReady = false;

async function ensureSettingsTable(): Promise<void> {
  if (tableReady) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS server_slot_settings (
    id INTEGER PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'automatic',
    min_slots INTEGER NOT NULL,
    max_slots INTEGER NOT NULL,
    manual_slots INTEGER NOT NULL,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(
    `INSERT INTO server_slot_settings (id, mode, min_slots, max_slots, manual_slots)
     VALUES (1, 'automatic', $1, $2, $1)
     ON CONFLICT (id) DO NOTHING`,
    [DEFAULT_MIN_SLOTS, DEFAULT_MAX_SLOTS],
  );
  tableReady = true;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

export async function getSlotControlSettings(): Promise<SlotControlSettings> {
  await ensureSettingsTable();
  const result = await pool.query<{
    mode: string;
    min_slots: number;
    max_slots: number;
    manual_slots: number;
    updated_by: string | null;
    updated_at: Date | null;
  }>(`SELECT mode, min_slots, max_slots, manual_slots, updated_by, updated_at FROM server_slot_settings WHERE id = 1`);
  const row = result.rows[0];
  const minSlots = clamp(Number(row?.min_slots) || DEFAULT_MIN_SLOTS, 1, HARD_MAX);
  const maxSlots = clamp(Number(row?.max_slots) || DEFAULT_MAX_SLOTS, minSlots, HARD_MAX);
  const manualSlots = clamp(Number(row?.manual_slots) || minSlots, 1, HARD_MAX);
  return {
    mode: row?.mode === "manual" ? "manual" : "automatic",
    minSlots,
    maxSlots,
    manualSlots,
    currentSlots,
    updatedBy: row?.updated_by ?? null,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

async function setSlots(newSlots: number): Promise<boolean> {
  const target = Math.max(1, Math.min(HARD_MAX, Math.round(newSlots)));
  const before = currentSlots;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await executeRconCommand(`server.maxplayers ${target}`).catch(() => null);
    if (result !== null) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const confirmed = await getServerInfo().catch(() => null);
      if (confirmed?.maxPlayers === target) {
        currentSlots = target;
        logger.info({ from: before, to: target, attempt }, "Server slots updated and confirmed");
        return true;
      }
    }
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 700));
  }
  logger.error({ from: before, target }, "Slot change was not confirmed by serverinfo");
  return false;
}

export async function updateSlotControlSettings(input: {
  mode: SlotControlMode;
  minSlots: number;
  maxSlots: number;
  manualSlots?: number;
  updatedBy?: string;
}): Promise<{ settings: SlotControlSettings; applied: boolean; serverPlayers: number }> {
  await ensureSettingsTable();
  const mode: SlotControlMode = input.mode === "manual" ? "manual" : "automatic";
  const minSlots = Math.round(Number(input.minSlots));
  const maxSlots = Math.round(Number(input.maxSlots));
  const manualSlots = Math.round(Number(input.manualSlots ?? minSlots));
  if (!Number.isFinite(minSlots) || minSlots < 1 || minSlots > HARD_MAX) throw new Error("Mínimo de slots inválido.");
  if (!Number.isFinite(maxSlots) || maxSlots < minSlots || maxSlots > HARD_MAX) throw new Error("Máximo de slots inválido.");
  if (!Number.isFinite(manualSlots) || manualSlots < 1 || manualSlots > HARD_MAX) throw new Error("Quantidade manual de slots inválida.");

  const info = await getServerInfo().catch(() => null);
  const players = info?.players ?? 0;
  if (mode === "manual" && manualSlots < players) {
    throw new Error(`O modo manual não pode ficar abaixo dos ${players} jogadores online.`);
  }

  await pool.query(
    `UPDATE server_slot_settings
       SET mode=$1, min_slots=$2, max_slots=$3, manual_slots=$4, updated_by=$5, updated_at=NOW()
     WHERE id=1`,
    [mode, minSlots, maxSlots, manualSlots, input.updatedBy ?? null],
  );

  let applied = true;
  if (mode === "manual") {
    applied = await setSlots(manualSlots);
  } else if (info) {
    // Returning to automatic mode immediately brings an out-of-range value
    // back inside the configured limits, without ever reducing below players.
    const real = info.maxPlayers || currentSlots || minSlots;
    currentSlots = real;
    if (real < minSlots) applied = await setSlots(Math.max(minSlots, players));
    else if (real > maxSlots && maxSlots >= players) applied = await setSlots(maxSlots);
  }

  return { settings: await getSlotControlSettings(), applied, serverPlayers: players };
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
    const settings = await getSlotControlSettings();
    const { players, queued, joining } = info;

    // Always trust the real server value when available. This keeps the bot and
    // panel synchronized even if someone changed maxplayers outside the panel.
    currentSlots = info.maxPlayers || currentSlots || settings.minSlots;

    if (settings.mode === "manual") {
      const target = Math.max(settings.manualSlots, players);
      if (currentSlots !== target) await setSlots(target);
      updatePresence(client, players, currentSlots ?? target);
      return;
    }

    const minSlots = settings.minSlots;
    const maxSlots = settings.maxSlots;

    if (currentSlots < minSlots) {
      await setSlots(Math.max(minSlots, players));
    } else if (currentSlots > maxSlots && maxSlots >= players) {
      await setSlots(maxSlots);
    } else if ((queued > 0 || joining > 0 || players >= currentSlots) && currentSlots < maxSlots) {
      const target = clamp(currentSlots + STEP, minSlots, maxSlots);
      if (await setSlots(target)) {
        lastExpansionAt = Date.now();
        logger.info({ players, queued, joining, to: target }, "Queue/full pressure detected — slots expanded");
      }
    } else if (queued === 0 && joining === 0 && Date.now() - lastExpansionAt >= SHRINK_HOLD_MS && currentSlots > minSlots && players <= currentSlots - STEP) {
      const target = clamp(currentSlots - STEP, minSlots, maxSlots);
      if (target >= players && await setSlots(target)) logger.info({ players, to: target }, "No queue — slots reduced");
    }

    updatePresence(client, players, currentSlots ?? info.maxPlayers ?? minSlots);
  }

  setTimeout(() => tick().catch(err => logger.error({ err }, "Slot manager tick error")), 10_000);
  setInterval(() => tick().catch(err => logger.error({ err }, "Slot manager tick error")), INTERVAL);
  logger.info({ defaultMin: DEFAULT_MIN_SLOTS, defaultMax: DEFAULT_MAX_SLOTS, step: STEP, intervalMs: INTERVAL, shrinkHoldMs: SHRINK_HOLD_MS }, "Slot manager started with panel control");
}
