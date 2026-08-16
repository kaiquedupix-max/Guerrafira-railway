import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type TextChannel,
} from "discord.js";
import { and, isNotNull, lte, eq, gt } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { getOnlinePlayers, executeRconCommand, getServerInfo, setRconEventHandler } from "./utils/rcon.js";
import { upsertPlayer, setAllOffline } from "./utils/players.js";
import { buildAutoUnbanEmbed, buildStatusEmbed } from "./utils/embeds.js";
import { db, modLogsTable } from "@workspace/db";
import { setDiscordClient } from "./client.js";
import { startVipExpiryChecker } from "./vip.js";
import { startBoosterSystem } from "./booster.js";
import { setupVipStore } from "./vipStore.js";
import { startSlotManager } from "./slotManager.js";
import { startLeaderboardChannel } from "./leaderboardChannel.js";
import { checkExpiredRaffles, handleRaffleJoin, handleRaffleModal } from "./raffle.js";
import { openVipModal, submitVipModal } from "./vipSteamLink.js";
import * as banirCommand from "./commands/banir.js";
import * as kickarCommand from "./commands/kickar.js";
import * as verificarCommand from "./commands/verificar.js";
import * as desbanirCommand from "./commands/desbanir.js";
import * as criarsorteioCommand from "./commands/criarsorteio.js";
import * as listvipsCommand from "./commands/listvips.js";
import * as meuvipCommand from "./commands/meuvip.js";
import * as ajudaCommand from "./commands/ajuda.js";
import * as ticketlogsCommand from "./commands/ticketlogs.js";
import { handleTicketLogSelect } from "./commands/ticketlogs.js";
import * as darvipCommand from "./commands/darvip.js";
import * as removervipCommand from "./commands/removervip.js";
import * as removerboosterCommand from "./commands/removerbooster.js";
import * as leaderboardCommand from "./commands/leaderboard.js";
import * as listaplayerCommand from "./commands/listaplayer.js";
import * as resetleaderboardCommand from "./commands/resetleaderboard.js";
import * as criarmapaCommand from "./commands/criarmapa.js";
import * as steamCommand from "./commands/steam.js";
import * as wipeCommand from "./commands/wipe.js";
import { handleMapVote } from "./commands/criarmapa.js";
import { parseKillEvent, parseGatherEvent, parseCraftEvent } from "./killTracker.js";
import { setupTicketPanel, handleTicketCreate, handleTicketTypeSelect, handleTicketClose, handleVipPayPix, handleVipPayCard, handlePixCopy } from "./tickets.js";

interface BotCommand {
  data: { name: string; toJSON(): unknown };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

const commands = new Collection<string, BotCommand>();
commands.set(banirCommand.data.name, banirCommand);
commands.set(kickarCommand.data.name, kickarCommand);
commands.set(verificarCommand.data.name, verificarCommand);
commands.set(desbanirCommand.data.name, desbanirCommand);
commands.set(criarsorteioCommand.data.name, criarsorteioCommand);
commands.set(listvipsCommand.data.name, listvipsCommand);
commands.set(meuvipCommand.data.name, meuvipCommand);
commands.set(ajudaCommand.data.name, ajudaCommand);
commands.set(ticketlogsCommand.data.name, ticketlogsCommand);
commands.set(darvipCommand.data.name, darvipCommand);
commands.set(removervipCommand.data.name, removervipCommand);
commands.set(removerboosterCommand.data.name, removerboosterCommand);
commands.set(leaderboardCommand.data.name, leaderboardCommand);
commands.set(listaplayerCommand.data.name, listaplayerCommand);
commands.set(resetleaderboardCommand.data.name, resetleaderboardCommand);
commands.set(criarmapaCommand.data.name, criarmapaCommand);
commands.set(steamCommand.data.name, steamCommand);
commands.set(wipeCommand.data.name, wipeCommand);

export async function startBot(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) { logger.warn("DISCORD_BOT_TOKEN not set — bot will not start"); return; }
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ];
  const client = new Client({ intents });
  client.once(Events.ClientReady, async (c) => {
    logger.info({ tag: c.user.tag }, "Discord bot online");
    const welcomeChannelId = process.env.DISCORD_WELCOME_CHANNEL_ID;
    const welcomeChannel = welcomeChannelId
      ? await c.channels.fetch(welcomeChannelId).catch((err) => {
          logger.error({ err, channelId: welcomeChannelId }, "Welcome channel fetch failed");
          return null;
        })
      : null;
    logger.info({
      enabled: process.env.DISCORD_WELCOME_ENABLED === "true",
      channelId: welcomeChannelId ?? null,
      channelFound: Boolean(welcomeChannel),
      sendable: Boolean(welcomeChannel?.isSendable()),
    }, "Welcome system initialized");
    setDiscordClient(c);
    c.user.setPresence({ status: "online", activities: [{ name: "estatísticas do wipe • /leaderboard", type: ActivityType.Watching }] });
    await registerSlashCommands(c);
    startRconSync(); startBanExpiryChecker(c); startStatusUpdater(c); startSlotManager(c); startLeaderboardChannel(c); setupRconEventBridge(c); startVipExpiryChecker(c); await startBoosterSystem(c);
    await setupTicketPanel(c); await setupVipStore(c); await checkExpiredRaffles(c);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isAutocomplete()) { const cmd = commands.get(interaction.commandName); if (cmd?.autocomplete) await cmd.autocomplete(interaction); return; }
      if (interaction.isChatInputCommand()) { const cmd = commands.get(interaction.commandName); if (cmd) await cmd.execute(interaction); return; }
      if (interaction.isButton()) {
        const id = interaction.customId;
        if (id === "status_connect") { await handleConnectButton(interaction); return; }
        if (id === "ticket_create") { await handleTicketCreate(interaction); return; }
        if (id === "ticket_close") { await handleTicketClose(interaction); return; }
        if (id === "raffle_join") { await handleRaffleJoin(interaction); return; }
        if (id === "vip_pay_pix") { await handleVipPayPix(interaction); return; }
        if (id === "vip_pay_card") { await handleVipPayCard(interaction); return; }
        if (id === "pix_copy") { await handlePixCopy(interaction); return; }
        if (id.startsWith("vip_select_")) { await openVipModal(interaction); return; }
        if (id.startsWith("mapvote:")) { await handleMapVote(interaction); return; }
        if (id.startsWith("lp_nav:")) { await listaplayerCommand.handleNav(interaction); return; }
        if (id.startsWith("lp_copy:")) { await listaplayerCommand.handleCopy(interaction); return; }
        if (id.startsWith("rlb_confirm:")) { await resetleaderboardCommand.handleConfirm(interaction); return; }
        if (id === "rlb_cancel") { await resetleaderboardCommand.handleCancel(interaction); return; }
        return;
      }
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "ticket_type_select") await handleTicketTypeSelect(interaction);
        else if (interaction.customId === "ticket_log_select") await handleTicketLogSelect(interaction);
        return;
      }
      if (interaction.isModalSubmit()) {
        const id = interaction.customId;
        if (id.startsWith("raffle_modal_")) { await handleRaffleModal(interaction); return; }
        if (id.startsWith("vip_modal_")) { await submitVipModal(interaction); return; }
      }
    } catch (err) {
      logger.error({ err }, "Interaction error");
      try {
        const payload = { content: "❌ Erro ao processar a interação.", ephemeral: true };
        if ("deferred" in interaction && "replied" in interaction) {
          const i = interaction as ChatInputCommandInteraction;
          if (i.deferred || i.replied) await i.editReply(payload).catch(() => {}); else await i.reply(payload).catch(() => {});
        }
      } catch {}
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    const channelId = process.env.DISCORD_WELCOME_CHANNEL_ID;
    logger.info({
      userId: member.id,
      guildId: member.guild.id,
      channelId: channelId ?? null,
    }, "New guild member received");

    if (!channelId) return;

    const channel = await member.guild.channels.fetch(channelId).catch((err) => {
      logger.error({ err, channelId, userId: member.id }, "Welcome channel fetch failed");
      return null;
    });
    if (!channel?.isSendable()) {
      logger.warn({ channelId, userId: member.id }, "Welcome channel unavailable");
      return;
    }

    const hour = Number(
      new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        hour12: false,
        timeZone: "America/Sao_Paulo",
      }).format(new Date()),
    );
    const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

    try {
      await channel.send({
      content: `🎉 <@${member.id}>`,
      embeds: [{
        color: 0xf1c40f,
        title: `${greeting}, ${member.user.globalName ?? member.user.username}! Seja bem-vindo(a) ao Guerra Fria.`,
        description:
          "Agradecemos por fazer parte da nossa comunidade! Antes de começar, leia atentamente o canal de **regras** e fique por dentro das orientações do servidor.\n\n" +
          "Caso precise de ajuda, abra um ticket para falar com a administração. Esperamos que você tenha uma excelente experiência conosco! 🛡️",
        thumbnail: { url: member.user.displayAvatarURL({ size: 256 }) },
        fields: [
          { name: "👥 Membro", value: `Você é o membro **#${member.guild.memberCount}** do servidor.`, inline: true },
          { name: "📋 Próximo passo", value: "Leia as regras e aproveite a comunidade.", inline: true },
        ],
        footer: { text: "Guerra Fria • Respeito, competição e comunidade" },
        timestamp: new Date().toISOString(),
      }],
      allowedMentions: { users: [member.id] },
      });

      logger.info({ userId: member.id, channelId }, "Welcome message sent");
    } catch (err) {
      logger.error({ err, userId: member.id, channelId }, "Welcome message failed");
    }
  });

  client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    const chatChannelId = process.env.DISCORD_CHAT_CHANNEL_ID;
    if (!chatChannelId || msg.channelId !== chatChannelId) return;
    const content = msg.content.trim(); if (!content) return;
    const displayName = msg.member?.displayName ?? msg.author.username;
    await executeRconCommand(`say <color=red>[Moderação]</color> <color=orange>${displayName}:</color> <color=green>${content}</color>`);
    await msg.react("✅").catch(() => {});
    logger.info({ author: displayName, content }, "Discord → RCON chat");
  });
  client.on(Events.Error, err => logger.error({ err }, "Discord client error"));
  await client.login(token);
}

async function handleConnectButton(interaction: Parameters<typeof handleTicketCreate>[0]): Promise<void> {
  const host = "elgae-sp1-m004.elgaehost.com.br"; const gamePort = "3008";
  await interaction.reply({ embeds: [{ color: 0x2ecc71, title: "🎮  Conectar ao Servidor", description: `Clique no link abaixo ou cole no console do jogo (F1):\n\n**\`steam://connect/${host}:${gamePort}\`**\n\nF1 → \`client.connect ${host}:${gamePort}\``, footer: { text: "Guerra Fria" } }], ephemeral: true });
}

async function registerSlashCommands(client: Client): Promise<void> {
  const clientId = process.env.DISCORD_CLIENT_ID; const guildId = process.env.DISCORD_GUILD_ID;
  if (!clientId) { logger.warn("DISCORD_CLIENT_ID not set"); return; }
  const commandData = [banirCommand, kickarCommand, verificarCommand, desbanirCommand, criarsorteioCommand, listvipsCommand, meuvipCommand, ajudaCommand, ticketlogsCommand, darvipCommand, removervipCommand, removerboosterCommand, leaderboardCommand, listaplayerCommand, resetleaderboardCommand, criarmapaCommand, steamCommand, wipeCommand].map(c => c.data.toJSON());
  try {
    if (guildId) { const guild = await client.guilds.fetch(guildId); await guild.commands.set(commandData); logger.info({ guildId }, "Slash commands registered"); }
    else { await client.application?.commands.set(commandData); logger.info("Slash commands registered globally"); }
  } catch (err) { logger.error({ err }, "Failed to register slash commands"); }
}

const recentEvents = new Map<string, number>();
function isDuplicate(type: string, message: string): boolean {
  const key = `${type}:${message.slice(0, 120)}`; const now = Date.now();
  if (recentEvents.has(key) && now - recentEvents.get(key)! < 3000) return true;
  recentEvents.set(key, now);
  if (recentEvents.size > 200) for (const [k, ts] of recentEvents) if (now - ts > 30000) recentEvents.delete(k);
  return false;
}

function setupRconEventBridge(client: Client): void {
  setRconEventHandler(async (type, message) => {
    if (isDuplicate(type, message)) return;
    if (type === "Chat") { await handleChatEvent(client, message).catch(err => logger.error({ err }, "Chat event error")); return; }
    parseKillEvent(type, message); parseGatherEvent(type, message); parseCraftEvent(type, message);
  });
}

interface RustChatPayload { Channel: number; Message: string; UserId: string; Username: string; }
const recentChatMessages = new Map<string, number>();
function isDuplicateChat(payload: RustChatPayload): boolean {
  const now = Date.now(); const key = `${payload.UserId}:${payload.Username.trim().toLowerCase()}:${payload.Message.trim().replace(/\s+/g, " ").toLowerCase()}`;
  const lastSeen = recentChatMessages.get(key); if (lastSeen && now - lastSeen < 2500) return true;
  recentChatMessages.set(key, now); if (recentChatMessages.size > 500) for (const [savedKey, timestamp] of recentChatMessages) if (now - timestamp > 15000) recentChatMessages.delete(savedKey);
  return false;
}

async function handleChatEvent(client: Client, raw: string): Promise<void> {
  const chatChannelId = process.env.DISCORD_CHAT_CHANNEL_ID; if (!chatChannelId) return;
  let payload: RustChatPayload; try { payload = JSON.parse(raw) as RustChatPayload; } catch { return; }
  if (!payload.UserId || payload.UserId === "0" || !payload.Message?.trim() || isDuplicateChat(payload)) return;
  const ch = await client.channels.fetch(chatChannelId).catch(() => null); if (ch?.isSendable()) await ch.send(`💬 **${payload.Username}**: ${payload.Message}`);
}

function startRconSync(): void {
  async function sync() { try { const players = await getOnlinePlayers(); await setAllOffline(); for (const p of players) await upsertPlayer(p); if (players.length > 0) logger.info({ count: players.length }, "RCON player sync complete"); } catch (err) { logger.error({ err }, "RCON sync error"); } }
  sync().catch(() => {}); setInterval(() => sync().catch(() => {}), 30_000);
}

function startBanExpiryChecker(client: Client): void {
  async function check() {
    const now = new Date();
    const expired = await db.select().from(modLogsTable).where(and(eq(modLogsTable.action, "BAN"), isNotNull(modLogsTable.banExpiresAt), lte(modLogsTable.banExpiresAt, now)));
    if (!expired.length) return;
    const unbanned = await db.select({ steamId: modLogsTable.steamId }).from(modLogsTable).where(and(eq(modLogsTable.action, "SYSTEM_UNBAN"), gt(modLogsTable.createdAt, new Date(now.getTime() - 35 * 86400000))));
    const unbannedSet = new Set(unbanned.map(r => r.steamId));
    for (const ban of expired) {
      if (unbannedSet.has(ban.steamId)) continue;
      await executeRconCommand(`unban ${ban.steamId}`);
      await db.insert(modLogsTable).values({ action: "SYSTEM_UNBAN", steamId: ban.steamId, playerName: ban.playerName, reason: "Banimento temporário expirado", adminId: "SYSTEM", adminName: "Sistema" });
      const logChannelId = process.env.DISCORD_LOG_CHANNEL_ID;
      if (logChannelId) { const ch = await client.channels.fetch(logChannelId).catch(() => null) as TextChannel | null; if (ch?.isSendable()) await ch.send({ embeds: [buildAutoUnbanEmbed({ playerName: ban.playerName ?? "Desconhecido", steamId: ban.steamId, originalReason: ban.reason ?? "—", duration: "temporário" })] }); }
    }
  }
  setInterval(() => check().catch(err => logger.error({ err }, "Ban expiry check error")), 60_000);
}

function startStatusUpdater(client: Client): void {
  const channelId = process.env.DISCORD_STATUS_CHANNEL_ID; if (!channelId) return;
  let statusMessageId: string | null = process.env.DISCORD_STATUS_MESSAGE_ID?.trim() || null;
  async function findExisting(ch: TextChannel) {
    if (statusMessageId) { const byId = await ch.messages.fetch(statusMessageId).catch(() => null); if (byId?.author.id === client.user?.id) return byId; }
    const recent = await ch.messages.fetch({ limit: 100 }).catch(() => null);
    return recent?.find(m => m.author.id === client.user?.id && (m.embeds[0]?.footer?.text?.includes("Status automático") || m.embeds[0]?.footer?.text?.includes("Atualizado automaticamente") || m.components.some(r => r.components.some(c => "customId" in c.data && c.data.customId === "status_connect")))) ?? null;
  }
  async function update() {
    try {
      const info = await getServerInfo(); const ch = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null; if (!ch?.isSendable()) return;
      const embed = buildStatusEmbed(info); const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("status_connect").setLabel("🎮 Conectar ao Servidor").setStyle(ButtonStyle.Success)); const existing = await findExisting(ch);
      if (existing) { statusMessageId = existing.id; await existing.edit({ embeds: [embed], components: [row] }); }
      else { const sent = await ch.send({ embeds: [embed], components: [row] }); statusMessageId = sent.id; logger.warn({ statusMessageId }, "No previous status message found; created one. Set DISCORD_STATUS_MESSAGE_ID to pin this message permanently."); }
    } catch (err) { logger.error({ err }, "Status update error"); }
  }
  update().catch(() => {}); setInterval(() => update().catch(() => {}), 60_000);
}
