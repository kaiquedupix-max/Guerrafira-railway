/** Singleton so the webhook handler can access the Discord client. */
import { type Client } from "discord.js";

let _client: Client | null = null;

export function setDiscordClient(client: Client): void {
  _client = client;
}

export function discordClient(): Client | null {
  return _client;
}
