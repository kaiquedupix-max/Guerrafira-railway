/** Singleton so the webhook handler can access the Discord client. */
import { type Client } from "discord.js";
import { startAdminNotificationBridge } from "./adminNotificationBridge.js";

let _client: Client | null = null;
let notificationBridgeStarted = false;

export function setDiscordClient(client: Client): void {
  _client = client;
  if (!notificationBridgeStarted) {
    notificationBridgeStarted = true;
    startAdminNotificationBridge(client);
  }
}

export function discordClient(): Client | null {
  return _client;
}
