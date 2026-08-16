import { db, playerStatsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Zera todo o histórico competitivo sem remover o cadastro dos jogadores. */
export async function resetAllLeaderboardStats(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await db.update(playerStatsTable).set({
        kills: 0,
        deaths: 0,
        headshots: 0,
        resourcesGathered: 0,
        woodGathered: 0,
        stoneGathered: 0,
        metalOreGathered: 0,
        sulfurOreGathered: 0,
        scrapGathered: 0,
        explosivesCrafted: 0,
        gunpowderCrafted: 0,
        c4Used: 0,
        rocketsUsed: 0,
        updatedAt: sql`now()`,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Falha ao resetar o leaderboard.");
}
