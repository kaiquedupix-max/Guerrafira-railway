import {
  ActionRowBuilder,
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
import {
  getOnlinePlayers,
  executeRconCommand,
  getServerInfo,
  setRconEventHandler,
} from "./utils/rcon.js";
import { upsertPlayer, setAllOffline } from "./utils/players.js";
import { buildAutoUnbanEmbed, buildStatusEmbed } from "./utils/embeds.js";
import { db, modLogsTable } from "@workspace/db";
import { setDiscordClient } from "./client.js";
import { startVipExpiryChecker } from "./vip.js";
import { startSlotManager } from "./slotManager.js";
import { startLeaderboardChannel } from "./leaderboardChannel.js";
import { checkExpiredRaffles, handleRaffleJoin, handleRaffleModal } from "./raffle.js";
import * as banirCommand      from "./commands/banir.js";
import * as kickarCommand     from "./commands/kickar.js";
import * as verificarCommand  from "./commands/verificar.js";
import * as desbanirCommand   from "./commands/desbanir.js";
import * as criarsorteioCommand from "./commands/criarsorteio.js";
import * as listvipsCommand      from "./commands/listvips.js";
import * as meuvipCommand        from "./commands/meuvip.js";
import * as ajudaCommand         from "./commands/ajuda.js";
import * as ticketlogsCommand    from "./commands/ticketlogs.js";
import { handleTicketLogSelect } from "./commands/ticketlogs.js";
import * as darvipCommand        from "./commands/darvip.js";
import * as removervipCommand    from "./commands/removervip.js";
import * as leaderboardCommand   from "./commands/leaderboard.js";
import * as listaplayerCommand      from "./commands/listaplayer.js";
import * as resetleaderboardCommand from "./commands/resetleaderboard.js";
import { parseKillEvent, parseGatherEvent, parseCraftEvent } from "./killTracker.js";
import {
  setupTicketPanel,
  handleTicketCreate,
  handleTicketTypeSelect,
  handleTicketClose,
  handleVipSelect,
  handleVipModal,
  handleVipPayPix,
  handleVipPayCard,
  handlePixCopy,
} from "./tickets.js";

// ─── Commands ─────────────────────────────────────────────────────────────────
interface BotCommand {
  data: { name: string; toJSON(): unknown };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

const commands = new Collection<string, BotCommand>();
commands.set(banirCommand.data.name,          banirCommand);
commands.set(kickarCommand.data.name,         kickarCommand);
commands.set(verificarCommand.data.name,      verificarCommand);
commands.set(desbanirCommand.data.name,       desbanirCommand);
commands.set(criarsorteioCommand.data.name,   criarsorteioCommand);
commands.set(listvipsCommand.data.name,       listvipsCommand);
commands.set(meuvipCommand.data.name,         meuvipCommand);
commands.set(ajudaCommand.data.name,          ajudaCommand);
commands.set(ticketlogsCommand.data.name,     ticketlogsCommand);
commands.set(darvipCommand.data.name,         darvipCommand);
commands.set(removervipCommand.data.name,     removervipCommand);
commands.set(leaderboardCommand.data.name,    leaderboardCommand);
commands.set(listaplayerCommand.data.name,       listaplayerCommand);
commands.set(resetleaderboardCommand.data.name, resetleaderboardCommand);

// ─── Bot startup ──────────────────────────────────────────────────────────────
export async function startBot(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) { logger.warn("DISCORD_BOT_TOKEN not set — bot will not start"); return; }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, async (c) => {
    logger.info({ tag: c.user.tag }, "Discord bot online");
    setDiscordClient(c);
    await registerSlashCommands(c);
    startRconSync();
    startBanExpiryChecker(c);
    startStatusUpdater(c);
    startSlotManager(c);
    startLeaderboardChannel(c);
    setupRconEventBridge(c);
    startVipExpiryChecker(c);
    await setupTicketPanel(c);
    await checkExpiredRaffles(c);
  });

  // ── All interactions ───────────────────────────────────────────────────────
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      // Autocomplete
      if (interaction.isAutocomplete()) {
        const cmd = commands.get(interaction.commandName);
        if (cmd?.autocomplete) await cmd.autocomplete(interaction);
        return;
      }

      // Slash commands
      if (interaction.isChatInputCommand()) {
        const cmd = commands.get(interaction.commandName);
        if (cmd) await cmd.execute(interaction);
        return;
      }

      // Buttons
      if (interaction.isButton()) {
        const id = interaction.customId;

        if (id === "status_connect")        { await handleConnectButton(interaction); return; }
        if (id === "ticket_create")         { await handleTicketCreate(interaction);  return; }
        if (id === "ticket_close")          { await handleTicketClose(interaction);   return; }
        if (id === "raffle_join")           { await handleRaffleJoin(interaction);    return; }
        if (id === "vip_pay_pix")           { await handleVipPayPix(interaction);     return; }
        if (id === "vip_pay_card")          { await handleVipPayCard(interaction);    return; }
        if (id === "pix_copy")              { await handlePixCopy(interaction); return; }
        if (id.startsWith("vip_select_"))   { await handleVipSelect(interaction);     return; }
        if (id.startsWith("lp_nav:"))        { await listaplayerCommand.handleNav(interaction);          return; }
        if (id.startsWith("lp_copy:"))       { await listaplayerCommand.handleCopy(interaction);         return; }
        if (id.startsWith("rlb_confirm:"))   { await resetleaderboardCommand.handleConfirm(interaction); return; }
        if (id === "rlb_cancel")             { await resetleaderboardCommand.handleCancel(interaction);  return; }
        return;
      }

      // Select menus
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "ticket_type_select") {
          await handleTicketTypeSelect(interaction);
        } else if (interaction.customId === "ticket_log_select") {
          await handleTicketLogSelect(interaction);
        }
        return;
      }

      // Modal submissions
      if (interaction.isModalSubmit()) {
        const id = interaction.customId;
        if (id.startsWith("raffle_modal_")) { await handleRaffleModal(interaction); return; }
        if (id.startsWith("vip_modal_"))    { await handleVipModal(interaction);    return; }
        return;
      }
    } catch (err) {
      logger.error({ err }, "Interaction error");
      try {
        const payload = { content: "❌ Erro ao processar a interação.", ephemeral: true };
        if ("deferred" in interaction && "replied" in interaction) {
          const i = interaction as ChatInputCommandInteraction;
          if (i.deferred || i.replied) await i.editReply(payload).catch(() => {});
          else await i.reply(payload).catch(() => {});
        }
      } catch { /* ignore */ }
    }
  });

  // ── Discord → RCON chat ────────────────────────────────────────────────────
  client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    const chatChannelId = process.env.DISCORD_CHAT_CHANNEL_ID;
    if (!chatChannelId || msg.channelId !== chatChannelId) return;

    const content = msg.content.trim();
    if (!content) return;

    const displayName = msg.member?.displayName ?? msg.author.username;
    // [Moderação] in red, message in green
    await executeRconCommand(
      `say <color=red>[Moderação]</color> <color=green>${displayName}: ${content}</color>`,
    );
    await msg.react("✅").catch(() => {});
    logger.info({ author: displayName, content }, "Discord → RCON chat");
  });

  client.on(Events.Error, (err) => logger.error({ err }, "Discord client error"));

  await client.login(token);
}

// ─── Connect button ───────────────────────────────────────────────────────────
async function handleConnectButton(interaction: Parameters<typeof handleTicketCreate>[0]): Promise<void> {
  const host     = process.env.RCON_HOST ?? "?";
  const gamePort = process.env.GAME_PORT ?? "28015";
  await interaction.reply({
    embeds: [{
      color: 0x2ecc71,
      title: "🎮  Conectar ao Servidor",
      description:
        `Clique no link abaixo ou cole no console do jogo (F1):\n\n` +
        `**\`steam://connect/${host}:${gamePort}\`**\n\n` +
        `F1 → \`client.connect ${host}:${gamePort}\``,
      footer: { text: "Guerra Fria" },
    }],
    ephemeral: true,
  });
}

// ─── Slash command registration ───────────────────────────────────────────────
async function registerSlashCommands(client: Client): Promise<void> {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId  = process.env.DISCORD_GUILD_ID;
  if (!clientId) { logger.warn("DISCORD_CLIENT_ID not set"); return; }

  const commandData = [
    banirCommand.data.toJSON(),
    kickarCommand.data.toJSON(),
    verificarCommand.data.toJSON(),
    desbanirCommand.data.toJSON(),
    criarsorteioCommand.data.toJSON(),
    listvipsCommand.data.toJSON(),
    meuvipCommand.data.toJSON(),
    ajudaCommand.data.toJSON(),
    ticketlogsCommand.data.toJSON(),
    darvipCommand.data.toJSON(),
    removervipCommand.data.toJSON(),
    leaderboardCommand.data.toJSON(),
    listaplayerCommand.data.toJSON(),
    resetleaderboardCommand.data.toJSON(),
  ];

  try {
    if (guildId) {
      const guild = await client.guilds.fetch(guildId);
      await guild.commands.set(commandData);
      logger.info({ guildId }, "Slash commands registered");
    } else {
      await client.application?.commands.set(commandData);
      logger.info("Slash commands registered globally");
    }
  } catch (err) {
    logger.error({ err }, "Failed to register slash commands");
  }
}

// ─── RCON event bridge (chat only — kill feed removed) ───────────────────────
const recentEvents = new Map<string, number>();
function isDuplicate(type: string, message: string): boolean {
  const key = `${type}:${message.slice(0, 120)}`;
  const now = Date.now();
  if (recentEvents.has(key) && now - recentEvents.get(key)! < 3000) return true;
  recentEvents.set(key, now);
  if (recentEvents.size > 200) {
    for (const [k, ts] of recentEvents) { if (now - ts > 30000) recentEvents.delete(k); }
  }
  return false;
}

function setupRconEventBridge(client: Client): void {
  setRconEventHandler(async (type, message) => {
    if (isDuplicate(type, message)) return;
    if (type === "Chat") {
      await handleChatEvent(client, message).catch((err) => logger.error({ err }, "Chat event error"));
      return;
    }
    // Stats tracking — kill / gather / craft events from plugins
    parseKillEvent(type, message);
    parseGatherEvent(type, message);
    parseCraftEvent(type, message);
  });
}

interface RustChatPayload { Channel: number; Message: string; UserId: string; Username: string }
async function handleChatEvent(client: Client, raw: string): Promise<void> {
  const chatChannelId = process.env.DISCORD_CHAT_CHANNEL_ID;
  if (!chatChannelId) return;
  let payload: RustChatPayload;
  try { payload = JSON.parse(raw) as RustChatPayload; } catch { return; }
  if (!payload.UserId || payload.UserId === "0") return;
  const ch = await client.channels.fetch(chatChannelId).catch(() => null);
  if (ch?.isSendable()) await ch.send(`💬 **${payload.Username}**: ${payload.Message}`);
}

// ─── Player sync ──────────────────────────────────────────────────────────────
function startRconSync(): void {
  async function sync() {
    try {
      const players = await getOnlinePlayers();
      await setAllOffline();
      for (const p of players) await upsertPlayer(p);
      if (players.length > 0) logger.info({ count: players.length }, "RCON player sync complete");
    } catch (err) { logger.error({ err }, "RCON sync error"); }
  }
  sync().catch(() => {});
  setInterval(() => sync().catch(() => {}), 30_000);
}

// ─── Ban expiry checker ───────────────────────────────────────────────────────
function startBanExpiryChecker(client: Client): void {
  async function check() {
    const now = new Date();
    const expired = await db.select().from(modLogsTable).where(
      and(eq(modLogsTable.action, "BAN"), isNotNull(modLogsTable.banExpiresAt), lte(modLogsTable.banExpiresAt, now)),
    );
    if (!expired.length) return;
    const unbanned = await db.select({ steamId: modLogsTable.steamId }).from(modLogsTable).where(
      and(eq(modLogsTable.action, "SYSTEM_UNBAN"), gt(modLogsTable.createdAt, new Date(now.getTime() - 35 * 86400000))),
    );
    const unbannedSet = new Set(unbanned.map((r) => r.steamId));
    for (const ban of expired) {
      if (unbannedSet.has(ban.steamId)) continue;
      await executeRconCommand(`unban ${ban.steamId}`);
      await db.insert(modLogsTable).values({ action: "SYSTEM_UNBAN", steamId: ban.steamId, playerName: ban.playerName, reason: `Ban expirado (${ban.banDuration ?? "?"})`, adminId: "SYSTEM", adminName: "Sistema Automático" });
      const ch = process.env.DISCORD_LOG_CHANNEL_ID ? await client.channels.fetch(process.env.DISCORD_LOG_CHANNEL_ID).catch(() => null) : null;
      if (ch?.isSendable()) await ch.send({ embeds: [buildAutoUnbanEmbed({ playerName: ban.playerName, steamId: ban.steamId, originalReason: ban.reason ?? "—", duration: ban.banDuration ?? "?" })] });
      logger.info({ steamId: ban.steamId }, "Ban auto-removed");
    }
  }
  setTimeout(() => check().catch(() => {}), 60_000);
  setInterval(() => check().catch((err) => logger.error({ err }, "Ban expiry error")), 5 * 60_000);
}

// ─── Status updater ───────────────────────────────────────────────────────────
function buildConnectRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("status_connect").setLabel("🎮  Conectar ao Servidor").setStyle(ButtonStyle.Success),
  );
}

function startStatusUpdater(client: Client): void {
  let statusMessageId: string | null = null;

  async function update() {
    const channelId = process.env.DISCORD_STATUS_CHANNEL_ID;
    if (!channelId) return;
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch?.isSendable()) return;
    const embed = buildStatusEmbed(await getServerInfo());
    const row   = buildConnectRow();

    if (statusMessageId) {
      try { await (ch as TextChannel).messages.fetch(statusMessageId).then((m) => m.edit({ embeds: [embed], components: [row] })); return; }
      catch { statusMessageId = null; }
    }
    try {
      const recent = await (ch as TextChannel).messages.fetch({ limit: 20 });
      const bot    = recent.find((m) => m.author.id === client.user?.id && m.embeds.length > 0);
      if (bot) { statusMessageId = bot.id; await bot.edit({ embeds: [embed], components: [row] }); return; }
    } catch { /* ignore */ }

    const sent = await ch.send({ embeds: [embed], components: [row] });
    statusMessageId = sent.id;
    logger.info({ channelId, messageId: statusMessageId }, "Status message posted");
  }

  update().catch((err) => logger.error({ err }, "Status update error"));
  setInterval(() => update().catch((err) => logger.error({ err }, "Status update error")), 60_000);
}
