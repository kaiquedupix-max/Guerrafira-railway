/** Singleton so the webhook handler can access the Discord client. */
import { type Client } from "discord.js";
import { startAdminNotificationBridge } from "./adminNotificationBridge.js";
import { restoreActiveMapVotes, startMapWipeScheduler } from "./commands/criarmapa.js";
import { logger } from "../lib/logger.js";
import { startDailyRestartScheduler } from "./autoRestart.js";
import { setupTicketClaimSystem } from "./ticketClaim.js";

let _client: Client | null = null;
let notificationBridgeStarted = false;

export function setDiscordClient(client: Client): void {
  _client = client;
  if (!notificationBridgeStarted) {
    notificationBridgeStarted = true;
    startAdminNotificationBridge(client);
  }

  setupTicketClaimSystem(client).catch((err) => {
    logger.error({ err }, "Failed to initialize ticket claim system");
  });

  // Restaura votações de mapa já existentes sem criar outra votação.
  // Mantém votos, mensagem e horário e apenas atualiza o visual/menções.
  restoreActiveMapVotes(client).catch((err) => {
    logger.error({ err }, "Failed to restore active map votes");
  });
  startMapWipeScheduler(client);
  startDailyRestartScheduler(client);
}

export function discordClient(): Client | null {
  return _client;
}
