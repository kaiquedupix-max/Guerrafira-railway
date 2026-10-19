import { pool, playerStatsTable, trioPlayerStatsTable } from "@workspace/db";
import { adminServer } from "./adminServerContext.js";
import type { GuerraFriaServerId } from "./servers.js";
export const playerStatsForServer=(server:GuerraFriaServerId=adminServer())=>server==="trio"?trioPlayerStatsTable:playerStatsTable;
let ready:Promise<void>|undefined;
export function ensureCompetitiveStore():Promise<void>{return ready??=pool.query(`
 CREATE TABLE IF NOT EXISTS trio_player_stats (LIKE player_stats INCLUDING ALL);
 CREATE TABLE IF NOT EXISTS leaderboard_event_receipts (event_id TEXT PRIMARY KEY,received_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS trio_player_stats_kills_idx ON trio_player_stats(kills DESC);
 `).then(()=>{}).catch(error=>{ready=undefined;throw error;});}
