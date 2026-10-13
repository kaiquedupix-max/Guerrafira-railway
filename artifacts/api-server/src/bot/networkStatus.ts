import { ActivityType, Client, EmbedBuilder, Events, GatewayIntentBits } from "discord.js";
import { executeServerRcon } from "./utils/serverRcon.js";
import { GUERRA_FRIA_SERVERS, type GuerraFriaServerId } from "../core/servers.js";
import { logger } from "../lib/logger.js";

export type OnlineSnapshot = { server: GuerraFriaServerId; online: boolean; players: number; maxPlayers: number; queued: number };
export function parseOnlineSnapshot(server: GuerraFriaServerId, raw: string | null): OnlineSnapshot {
  const unavailable = { server, online: false, players: 0, maxPlayers: 0, queued: 0 };
  if (!raw) return unavailable;
  try {
    const data = JSON.parse(raw);
    const players = Number(data.Players ?? data.players ?? data.PlayerCount);
    const capacity = Number(data.MaxPlayers ?? data.maxPlayers ?? data.Capacity);
    if (!Number.isSafeInteger(players) || players < 0 || !Number.isFinite(capacity) || capacity <= 0) return unavailable;
    return { server, online: true, players, maxPlayers: capacity, queued: Math.max(0, Number(data.Queued ?? data.queued ?? 0) || 0) };
  } catch { return unavailable; }
}
export function networkPresence(snapshots: OnlineSnapshot[]): string {
  const total = snapshots.reduce((sum, s) => sum + s.players, 0);
  const missing = snapshots.filter(s => !s.online).map(s => GUERRA_FRIA_SERVERS[s.server].shortName);
  return missing.length ? `${total}+ online • ${missing.join("/")} indisponível` : `${total} jogadores online • Guerra Fria`;
}
export function startNetworkStatus(main: Client): void {
  const clients = new Map<GuerraFriaServerId, Client>();
  const messageIds = new Map<GuerraFriaServerId, string>();
  let busy = false;
  const refresh = async () => {
    if (busy || !main.isReady()) return;
    busy = true;
    try {
      const servers: GuerraFriaServerId[] = ["solo-duo", "trio"];
      const snapshots = await Promise.all(servers.map(async server => {
        try { return parseOnlineSnapshot(server, await executeServerRcon(server, "serverinfo")); }
        catch { return parseOnlineSnapshot(server, null); }
      }));
      main.user!.setPresence({ status: snapshots.every(s => s.online) ? "online" : "idle", activities: [{ name: networkPresence(snapshots), type: ActivityType.Watching }] });
      for (const snapshot of snapshots) {
        const client = clients.get(snapshot.server);
        if (!client?.isReady()) continue;
        const name = GUERRA_FRIA_SERVERS[snapshot.server].shortName;
        client.user!.setPresence({ status: snapshot.online ? "online" : "idle", activities: [{ type: ActivityType.Watching, name: snapshot.online ? `${snapshot.players}/${snapshot.maxPlayers} online • ${name}` : `${name} • conexão indisponível` }] });
        const channelId = process.env[snapshot.server === "trio" ? "TRIO_STATUS_CHANNEL_ID" : "DUO_STATUS_CHANNEL_ID"]?.trim();
        if (!channelId) continue;
        try {
          const channel = await client.channels.fetch(channelId);
          if (!channel?.isSendable()) continue;
          const marker = `Guerra Fria • Status ${name}`;
          const embed = new EmbedBuilder().setTitle(`Guerra Fria ${name} • Status`).setColor(snapshot.online ? 0x2ecc71 : 0xf59e0b).setDescription(snapshot.online ? `**${snapshot.players}/${snapshot.maxPlayers} jogadores online**\nFila: ${snapshot.queued}` : "Conexão com o servidor indisponível. Quantidade de jogadores não confirmada.").setFooter({ text: marker }).setTimestamp();
          const known = messageIds.get(snapshot.server);
          const previous = known ? await channel.messages.fetch(known).catch(() => null) : (await channel.messages.fetch({ limit: 100 })).find(m => m.author.id === client.user!.id && m.embeds.some(e => e.footer?.text === marker));
          const message = previous ? await previous.edit({ embeds: [embed] }) : await channel.send({ embeds: [embed] });
          messageIds.set(snapshot.server, message.id);
        } catch (error) { logger.error({ error, server: snapshot.server }, "Status channel update failed"); }
      }
    } finally { busy = false; }
  };
  const seen = new Set<string>([process.env.DISCORD_BOT_TOKEN || ""]);
  for (const server of ["solo-duo", "trio"] as const) {
    const token = (server === "trio" ? process.env.TRIO_STATUS_BOT_TOKEN || process.env.TRIO_DISCORD_BOT_TOKEN : process.env.DUO_STATUS_BOT_TOKEN)?.trim();
    if (!token) { logger.info({ server }, "Dedicated status bot token not configured"); continue; }
    if (seen.has(token)) { logger.error({ server }, "Each status bot must use its own Discord token"); continue; }
    seen.add(token);
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    clients.set(server, client);
    client.on(Events.Error, error => logger.error({ error, server }, "Status bot error"));
    client.once(Events.ClientReady, () => { logger.info({ server, botId: client.user?.id }, "Dedicated status bot online"); refresh().catch(error => logger.error({ error }, "Network status update failed")); });
    client.login(token).catch(error => logger.error({ error, server }, "Dedicated status bot login failed"));
  }
  refresh().catch(error => logger.error({ error }, "Network status update failed"));
  const timer = setInterval(() => refresh().catch(error => logger.error({ error }, "Network status update failed")), 30_000);
  timer.unref();
}
