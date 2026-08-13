import { pool } from "@workspace/db";
import { discordClient } from "./bot/client.js";
import { logger } from "./lib/logger.js";

let started = false;

async function disableTicketLogStorage(): Promise<void> {
  await pool.query("TRUNCATE TABLE ticket_logs RESTART IDENTITY");
  await pool.query(`
    CREATE OR REPLACE FUNCTION guerrafria_discard_ticket_log()
    RETURNS trigger AS $$
    BEGIN
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query("DROP TRIGGER IF EXISTS guerrafria_no_ticket_log_storage ON ticket_logs");
  await pool.query(`
    CREATE TRIGGER guerrafria_no_ticket_log_storage
    BEFORE INSERT ON ticket_logs
    FOR EACH ROW
    EXECUTE FUNCTION guerrafria_discard_ticket_log();
  `);
  logger.info("Ticket log persistence disabled and existing ticket logs removed");
}

async function cleanupDatabase(): Promise<void> {
  // VIP já expirado não precisa permanecer no banco. O atraso garante que o
  // checker do bot tenha tempo de retirar cargo/grupo antes da exclusão.
  const expiredVips = await pool.query(`
    DELETE FROM vip_subscriptions
    WHERE expires_at < NOW() - INTERVAL '15 minutes'
  `);

  // Banimentos e verificações são históricos permanentes. Logs operacionais
  // comuns têm retenção curta; SYSTEM_UNBAN fica tempo suficiente para impedir
  // processamento repetido de banimentos temporários expirados.
  const oldOperationalLogs = await pool.query(`
    DELETE FROM mod_logs
    WHERE action NOT IN ('BAN', 'VERIFICAR', 'SYSTEM_UNBAN')
      AND created_at < NOW() - INTERVAL '7 days'
  `);
  const oldUnbans = await pool.query(`
    DELETE FROM mod_logs
    WHERE action = 'SYSTEM_UNBAN'
      AND created_at < NOW() - INTERVAL '40 days'
  `);

  // Pagamentos servem para conciliação recente e idempotência, mas não precisam
  // ocupar espaço indefinidamente.
  const oldPayments = await pool.query(`
    DELETE FROM payments
    WHERE created_at < NOW() - INTERVAL '90 days'
  `);

  logger.info({
    expiredVips: expiredVips.rowCount ?? 0,
    oldOperationalLogs: oldOperationalLogs.rowCount ?? 0,
    oldUnbans: oldUnbans.rowCount ?? 0,
    oldPayments: oldPayments.rowCount ?? 0,
  }, "Database retention cleanup complete");
}

async function removeTicketLogsSlashCommand(): Promise<void> {
  const client = discordClient();
  if (!client?.isReady()) return;

  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  if (guildId) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;
    const commands = await guild.commands.fetch().catch(() => null);
    const command = commands?.find(c => c.name === "ticketlogs");
    if (command) {
      await guild.commands.delete(command.id).catch(err => logger.warn({ err }, "Failed to remove /ticketlogs"));
      logger.info("Removed /ticketlogs from guild commands");
    }
    return;
  }

  const commands = await client.application?.commands.fetch().catch(() => null);
  const command = commands?.find(c => c.name === "ticketlogs");
  if (command) {
    await client.application?.commands.delete(command.id).catch(err => logger.warn({ err }, "Failed to remove global /ticketlogs"));
    logger.info("Removed global /ticketlogs command");
  }
}

export function startStoragePolicy(): void {
  if (started) return;
  started = true;

  disableTicketLogStorage().catch(err => logger.error({ err }, "Failed to disable ticket log persistence"));

  // O bot registra slash commands no Ready. Remove o comando antigo depois
  // dessa etapa para ele desaparecer do Discord sem precisar guardar logs.
  setTimeout(() => removeTicketLogsSlashCommand().catch(() => {}), 20_000);

  // Dá tempo para o checker de VIP (primeira execução em ~30 s) processar
  // expirações antes da primeira limpeza.
  setTimeout(() => cleanupDatabase().catch(err => logger.error({ err }, "Initial DB cleanup failed")), 2 * 60_000);
  setInterval(() => cleanupDatabase().catch(err => logger.error({ err }, "Scheduled DB cleanup failed")), 60 * 60_000);
}
