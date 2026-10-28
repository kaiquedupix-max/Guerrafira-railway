import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, modLogsTable } from "@workspace/db";

/** Filter in PostgreSQL before limiting, including hidden terminal state. */
export function publicModerationRecords() {
  return db.select().from(modLogsTable).where(and(
    eq(modLogsTable.publicVisible, true),
    inArray(modLogsTable.action, ["WARN", "BAN", "VERIFICAR"]),
    sql`(${modLogsTable.action} <> 'BAN' OR NOT EXISTS (
      SELECT 1 FROM mod_logs later
      WHERE later.steam_id = ${modLogsTable.steamId} AND later.id > ${modLogsTable.id}
      AND later.action IN ('BAN', 'PREVENTIVE_BAN', 'DESBANIR', 'SYSTEM_UNBAN')
    ))`,
    sql`(${modLogsTable.action} <> 'WARN' OR NOT EXISTS (
      SELECT 1 FROM mod_logs removed
      WHERE removed.action = 'WARN_REMOVED' AND removed.server_id = ${modLogsTable.serverId}
      AND removed.steam_id = ${modLogsTable.steamId}
      AND split_part(removed.reason, ' | ', 1) = concat('warningId:', ${modLogsTable.id})
    ))`,
  )).orderBy(desc(modLogsTable.createdAt), desc(modLogsTable.id)).limit(2000);
}
