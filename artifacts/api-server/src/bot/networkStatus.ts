import { withAdminServer } from "../core/adminServerContext.js";
import { getHostPowerState } from "../core/hostWipe.js";
import { wipeScheduleLabel } from "../core/wipeCalendar.js";
import { ActivityType, Client, EmbedBuilder, Events, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ButtonInteraction } from "discord.js";
import { executeServerRcon } from "./utils/serverRcon.js";
import { GUERRA_FRIA_SERVERS, type GuerraFriaServerId } from "../core/servers.js";
import { logger } from "../lib/logger.js";

export type OnlineSnapshot = { server: GuerraFriaServerId; online: boolean; players: number; maxPlayers: number; queued: number; populationAvailable?: boolean; hostState?: string };
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
export function snapshotWithHostState(snapshot: OnlineSnapshot, hostState: string | null): OnlineSnapshot {
  if (snapshot.online) return snapshot;
  const state = hostState?.toLowerCase();
  return { ...snapshot, online: state === "running", populationAvailable: false, hostState: state || "unavailable" };
}
export async function getStatusSnapshot(server: GuerraFriaServerId): Promise<OnlineSnapshot> {
  const raw = await executeServerRcon(server, "serverinfo").catch(() => null);
  const snapshot = parseOnlineSnapshot(server, raw);
  if (snapshot.online) return snapshot;
  const state = await withAdminServer(server, () => getHostPowerState()).catch(() => null);
  return snapshotWithHostState(snapshot, state);
}
export function serverPresence(snapshot: OnlineSnapshot): string {
  const name = GUERRA_FRIA_SERVERS[snapshot.server].shortName;
  if (snapshot.populationAvailable === false && snapshot.online) return `${name} • online • contagem indisponível`;
  if (snapshot.hostState === "starting") return `${name} • iniciando`;
  if (snapshot.hostState === "offline") return `${name} • offline`;
  return snapshot.online ? `${snapshot.players}/${snapshot.maxPlayers} online • ${name}` : `${name} • conexão indisponível`;
}
export function networkPresence(snapshots: OnlineSnapshot[]): string {
  const total = snapshots.reduce((sum, s) => sum + s.players, 0);
  const slots = snapshots.reduce((sum,s)=>sum+s.maxPlayers,0);
  const missing = snapshots.filter(s => !s.online || s.populationAvailable === false).map(s => GUERRA_FRIA_SERVERS[s.server].shortName);
  return missing.length ? `${total}+/${slots}+ online • contagem ${missing.join("/")} indisponível` : `${total}/${slots} jogadores online • Guerra Fria`;
}
export function statusCardPayload(snapshot: OnlineSnapshot) {
  const name=GUERRA_FRIA_SERVERS[snapshot.server].shortName;
  const marker=`Guerra Fria • Status ${name}`;
  const embed = new EmbedBuilder().setTitle(`Guerra Fria ${name} • Status`).setColor(snapshot.online ? 0x2ecc71 : 0xf59e0b).setDescription(snapshot.online ? snapshot.populationAvailable === false ? "**Servidor online**\nA hospedagem confirmou que está em execução. Contagem de jogadores indisponível no momento." : `**${snapshot.players}/${snapshot.maxPlayers} jogadores online**\nFila: ${snapshot.queued}` : snapshot.hostState === "starting" ? "**Servidor iniciando**" : snapshot.hostState === "offline" ? "**Servidor offline**" : "Conexão com o servidor indisponível. Quantidade de jogadores não confirmada.").addFields({name:"Wipe de mapa",value:wipeScheduleLabel(snapshot.server)}).setFooter({ text: marker }).setTimestamp();
  const components = [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Success).setLabel("🎮 Conectar ao servidor")
      .setCustomId(snapshot.server === "trio" ? "status_connect_trio" : "status_connect"),
  )];
  return { embeds: [embed], components };
}
// Public game endpoints; these are not the RCON or hosting-panel ports.
const GAME_ENDPOINTS: Record<GuerraFriaServerId, string> = {
  "solo-duo": "jogar.guerrafriarust.com.br:28015",
  trio: "jogar.guerrafriarust.com.br:28115",
};
export function statusConnectReply(server: GuerraFriaServerId) {
  const address = GAME_ENDPOINTS[server];
  return {
    content: `**Guerra Fria ${GUERRA_FRIA_SERVERS[server].shortName}**\n\n**IP do servidor:**\n\`\`\`text\n${address}\n\`\`\`\n**Copie o comando e cole no console do Rust (F1):**\n\`\`\`text\nclient.connect ${address}\n\`\`\``,
    flags: MessageFlags.Ephemeral as const,
  };
}
export async function handleStatusConnectButton(interaction: ButtonInteraction, server?: GuerraFriaServerId): Promise<boolean> {
  const target = interaction.customId === "status_connect" ? "solo-duo"
    : interaction.customId === "status_connect_trio" ? "trio" : null;
  if (!target || server && target !== server) return false;
  await interaction.reply(statusConnectReply(target));
  return true;
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
      const snapshots = await Promise.all(servers.map(getStatusSnapshot));
      main.user!.setPresence({ status: snapshots.every(s => s.online) ? "online" : "idle", activities: [{ name: networkPresence(snapshots), type: ActivityType.Watching }] });
      for (const snapshot of snapshots) {
        const client = clients.get(snapshot.server);
        if (!client?.isReady()) continue;
        const name = GUERRA_FRIA_SERVERS[snapshot.server].shortName;
        client.user!.setPresence({ status: snapshot.online ? "online" : "idle", activities: [{ type: ActivityType.Watching, name: serverPresence(snapshot) }] });
        const channelId = process.env[snapshot.server === "trio" ? "TRIO_STATUS_CHANNEL_ID" : "DUO_STATUS_CHANNEL_ID"]?.trim();
        if (!channelId) continue;
        try {
          const channel = await client.channels.fetch(channelId);
          if (!channel?.isSendable()) continue;
          const marker = `Guerra Fria • Status ${name}`;
          const known = messageIds.get(snapshot.server);
          const previous = known ? await channel.messages.fetch(known).catch(() => null) : (await channel.messages.fetch({ limit: 100 })).find(m => m.author.id === client.user!.id && m.embeds.some(e => e.footer?.text === marker));
          const payload = statusCardPayload(snapshot);
          const message = previous ? await previous.edit(payload) : await channel.send(payload);
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
    client.on(Events.InteractionCreate, async interaction => {
      if (!interaction.isButton()) return;
      try { await handleStatusConnectButton(interaction, server); }
      catch (error) { logger.error({ error, server }, "Status connect button failed"); }
    });
    client.on(Events.Error, error => logger.error({ error, server }, "Status bot error"));
    client.once(Events.ClientReady, () => { logger.info({ server, botId: client.user?.id }, "Dedicated status bot online"); refresh().catch(error => logger.error({ error }, "Network status update failed")); });
    client.login(token).catch(error => logger.error({ error, server }, "Dedicated status bot login failed"));
  }
  removeLegacyStatus(main).catch(error => logger.error({error},"Legacy status cleanup failed"));
  refresh().catch(error => logger.error({ error }, "Network status update failed"));
  const timer = setInterval(() => refresh().catch(error => logger.error({ error }, "Network status update failed")), 30_000);
  timer.unref();
}

export async function removeLegacyStatus(main:Client):Promise<void>{
 const channelId=process.env.DISCORD_STATUS_CHANNEL_ID;if(!channelId)return;
 const channel=await main.channels.fetch(channelId);if(!channel?.isSendable())return;
 let before:string|undefined;
 for(;;){const messages=await channel.messages.fetch({limit:100,...(before?{before}:{})});if(!messages.size)break;
  for(const message of messages.values()){
   if(message.author.id!==main.user?.id)continue;
   if(!message.embeds.some(e=>/Atualizado automaticamente a cada 60s|Status automático/.test(e.footer?.text||"")))continue;
   await message.delete();
  }
  before=messages.last()!.id;if(messages.size<100)break;
 }
}
