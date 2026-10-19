import { clearReadCache } from "./readCache.js";
import { playerStatsForServer, ensureCompetitiveStore } from "./competitiveStore.js";
import { lockLeaderboardEpoch } from "./leaderboardEpoch.js";
import { adminServer } from "./adminServerContext.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
/** Clears this wipe's statistics, including the player count. Directory/Season stay intact. */
export async function resetAllLeaderboardStats():Promise<void>{
 await ensureCompetitiveStore();
 await db.transaction(async tx=>{
  await lockLeaderboardEpoch(tx);
  await tx.delete(playerStatsForServer());
  await tx.execute(sql`UPDATE leaderboard_wipe_state SET reset_after_ms=${Date.now()} WHERE server_id=${adminServer()}`);
 });
 clearReadCache();
}
