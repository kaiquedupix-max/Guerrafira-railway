/** Singleton so the webhook handler can access the Discord client. */
import { type Client } from "discord.js";
import { startAdminNotificationBridge } from "./adminNotificationBridge.js";
import { restoreActiveMapVotes } from "./commands/criarmapa.js";
import { logger } from "../lib/logger.js";

let _client: Client | null = null;
let notificationBridgeStarted = false;

export function setDiscordClient(client: Client): void {
  _client = client;
  if (!notificationBridgeStarted) {
    notificationBridgeStarted = true;
    startAdminNotificationBridge(client);
  }

  // Restaura votações de mapa já existentes sem criar outra votação.
  // Mantém votos, mensagem e horário e apenas atualiza o visual/menções.
  restoreActiveMapVotes(client).catch((err) => {
    logger.error({ err }, "Failed to restore active map votes");
  });
}

export function discordClient(): Client | null {
  return _client;
}
