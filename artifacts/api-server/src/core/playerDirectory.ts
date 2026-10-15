import { pool } from "@workspace/db";
import { adminServer, withAdminServer } from "./adminServerContext.js";
import type { GuerraFriaServerId } from "./servers.js";
import { getOnlinePlayers } from "../bot/utils/rcon.js";
import { logger } from "../lib/logger.js";
let ready: Promise<void> | undefined;
export function ensurePlayerDirectory(): Promise<void> {
  return ready ??= pool.query(`CREATE TABLE IF NOT EXISTS gf_server_players (
    server_id TEXT NOT NULL, steam_id TEXT NOT NULL, player_name TEXT NOT NULL,
    is_online BOOLEAN NOT NULL DEFAULT FALSE, ping INTEGER NOT NULL DEFAULT 0,
    last_ip TEXT, first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(server_id, steam_id));
    CREATE INDEX IF NOT EXISTS gf_players_online_idx ON gf_server_players(server_id, is_online, last_seen DESC);
    INSERT INTO gf_server_players(server_id,steam_id,player_name,is_online,first_seen,last_seen)
    SELECT 'solo-duo',steam_id,player_name,FALSE,first_seen,last_seen FROM players ON CONFLICT DO NOTHING;
  `).then(() => {}).catch(error => {ready=undefined;throw error;});
}
const refreshes = new Map<string, Promise<void>>();
export function refreshPlayerDirectory(server: GuerraFriaServerId): Promise<void> {
  const pending=refreshes.get(server);if(pending)return pending;
  const task=withAdminServer(server,async()=>{
    await ensurePlayerDirectory();
    const online=await getOnlinePlayers(); // failure must not mark everyone offline
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE gf_server_players SET is_online=FALSE WHERE server_id=$1 AND is_online=TRUE",[server]);
      if(online.length) await client.query(`INSERT INTO gf_server_players(server_id,steam_id,player_name,is_online,ping,last_ip)
        SELECT $1,p.steam_id,p.player_name,TRUE,p.ping,NULLIF(p.ip,'') FROM jsonb_to_recordset($2::jsonb)
        AS p(steam_id TEXT,player_name TEXT,ping INTEGER,ip TEXT)
        ON CONFLICT(server_id,steam_id) DO UPDATE SET player_name=EXCLUDED.player_name,is_online=TRUE,
        ping=EXCLUDED.ping,last_ip=COALESCE(EXCLUDED.last_ip,gf_server_players.last_ip),last_seen=NOW()`,
        [server,JSON.stringify(online.map(p=>({steam_id:p.steamId,player_name:p.name,ping:p.ping,ip:p.ipAddress||""})))]);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
  }).finally(()=>refreshes.delete(server));
  refreshes.set(server,task);return task;
}
export async function directoryPlayers(query="",limit=25,offset=0,mode="all") {
  await ensurePlayerDirectory();
  const q=query.trim().slice(0,100), size=Math.min(500,Math.max(1,Math.trunc(limit)||25));
  const {rows}=await pool.query(`SELECT steam_id AS "steamId",player_name AS "playerName",is_online AS "isOnline",
    ping,first_seen AS "firstSeen",last_seen AS "lastSeen",count(*) OVER()::int AS total
    FROM gf_server_players WHERE server_id=$1 AND ($2='' OR player_name ILIKE $3 OR steam_id LIKE $3)
    AND ($4<>'online' OR is_online=TRUE) ORDER BY is_online DESC,last_seen DESC,steam_id LIMIT $5 OFFSET $6`,
    [adminServer(),q,'%'+q.replace(/[\\%_]/g,'\\$&')+'%',mode,size,Math.max(0,Math.trunc(offset)||0)]);
  return {rows,total:Number(rows[0]?.total||0)};
}
export async function directoryPlayer(steamId:string) {
  const {rows}=await pool.query(`SELECT steam_id AS "steamId",player_name AS "playerName",is_online AS "isOnline",
    ping,last_seen AS "lastSeen",first_seen AS "firstSeen" FROM gf_server_players WHERE server_id=$1 AND steam_id=$2`,[adminServer(),steamId]);
  return rows[0]||null;
}
export async function knownPlayerAddresses(steamId:string):Promise<string[]> {
  const {rows}=await pool.query("SELECT last_ip FROM gf_server_players WHERE steam_id=$1 AND last_ip IS NOT NULL ORDER BY last_seen DESC",[steamId]);
  return [...new Set(rows.map(r=>String(r.last_ip)))];
}
let started=false;
export function startPlayerDirectory():void {
  if(started)return;started=true;
  const tick=()=>{for(const server of ["solo-duo","trio"] as const)void refreshPlayerDirectory(server).catch(error=>logger.warn({error,server},"Player directory refresh unavailable"));};
  tick();setInterval(tick,10000).unref();
}
