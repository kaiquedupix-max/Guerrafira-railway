import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { adminServer } from "./adminServerContext.js";
import { playerStatsForServer } from "./competitiveStore.js";
import { clearReadCache } from "./readCache.js";
type Store=Pick<typeof db,"execute"|"delete">;
export async function lockLeaderboardEpoch(store:Store){
 await store.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'gf-leaderboard:'+adminServer()}))`);
 await store.execute(sql`INSERT INTO leaderboard_wipe_state(server_id) VALUES(${adminServer()}) ON CONFLICT DO NOTHING`);
}
/** Runs under the same lock as a manual/host reset, so old events cannot race it. */
export async function prepareLeaderboardEvent(store:Store,event:Record<string,unknown>):Promise<boolean>{
 await lockLeaderboardEpoch(store);
 const result=await store.execute(sql`SELECT map_created_ms,reset_after_ms FROM leaderboard_wipe_state WHERE server_id=${adminServer()}`);
 const state=result.rows[0] as {map_created_ms:string|number|null;reset_after_ms:string|number};
 let cutoff=Number(state.reset_after_ms),map=state.map_created_ms===null?null:Number(state.map_created_ms);
 const incoming=event.wipe_started_at===undefined?null:Number(event.wipe_started_at);
 const timestamp=Number(event.timestamp);
 if(event.timestamp!==undefined&&(!Number.isFinite(timestamp)||timestamp<=0||timestamp>Date.now()+60000))return false;
 if(incoming!==null){
  if(!Number.isFinite(incoming)||incoming<=0||incoming>Date.now()+60000||!Number.isFinite(timestamp)||timestamp<incoming)return false;
  if(map!==null&&incoming<map)return false;
  if(map===null||incoming>map){
   if(map!==null){await store.delete(playerStatsForServer());cutoff=Math.max(cutoff,incoming);clearReadCache();}
   await store.execute(sql`UPDATE leaderboard_wipe_state SET map_created_ms=${incoming},reset_after_ms=${cutoff} WHERE server_id=${adminServer()}`);
   map=incoming;
  }
 }
 if(cutoff>0&&(!Number.isFinite(timestamp)||timestamp<cutoff))return false;
 return true;
}
