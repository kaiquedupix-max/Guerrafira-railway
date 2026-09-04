import { db, mapVotesTable } from "@workspace/db";
import { and, eq, gte, lt } from "drizzle-orm";
import { logger } from "../lib/logger.js";

/**
 * One-time recovery for the 04/09/2026 wipe after the accidental early apply.
 *
 * Correct schedule (America/Sao_Paulo):
 * - vote closes: 04/09/2026 18:00
 * - technical flow: 04/09/2026 18:25
 * - official wipe: 04/09/2026 18:30
 *
 * The repair is deliberately scoped to the affected legacy vote window only.
 * It reopens the same vote, preserving all ballots, and lets the normal runtime
 * close it at 18:00 and execute the winner at 18:25.
 */
export async function repairWipeSchedule20260904(): Promise<void> {
  const legacyEndsStart = new Date("2026-09-03T20:55:00.000Z");
  const legacyEndsEnd = new Date("2026-09-03T21:05:00.000Z");
  const correctEndsAt = new Date("2026-09-04T21:00:00.000Z");
  const correctFlowAt = new Date("2026-09-04T21:25:00.000Z");

  const rows = await db
    .select()
    .from(mapVotesTable)
    .where(and(gte(mapVotesTable.endsAt, legacyEndsStart), lt(mapVotesTable.endsAt, legacyEndsEnd)))
    .limit(5);

  if (!rows.length) return;

  // Only touch the most recent affected row. This cannot modify unrelated wipes.
  const target = rows.sort((a, b) => b.id - a.id)[0];

  const alreadyCorrect =
    target.endsAt?.getTime() === correctEndsAt.getTime() &&
    target.wipeAt?.getTime() === correctFlowAt.getTime() &&
    target.status === "active";
  if (alreadyCorrect) return;

  await db
    .update(mapVotesTable)
    .set({
      endsAt: correctEndsAt,
      wipeAt: correctFlowAt,
      status: "active",
      winnerIndex: null,
      appliedAt: null,
      failureReason: null,
    })
    .where(eq(mapVotesTable.id, target.id));

  logger.warn(
    {
      voteId: target.id,
      voteEndsAt: correctEndsAt.toISOString(),
      flowAt: correctFlowAt.toISOString(),
      officialWipeAt: "2026-09-04T21:30:00.000Z",
    },
    "Recovered affected map vote to the correct 04/09/2026 schedule",
  );
}
