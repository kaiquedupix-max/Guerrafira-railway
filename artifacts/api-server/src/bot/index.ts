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
import * as banpreventivoCommand from "./commands/banpreventivo.js";
import * as kickarCommand from "./commands/kickar.js";
import * as muteCommand from "./commands/mute.js";
import * as unmuteCommand from "./commands/unmute.js";
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
import * as votacaoCommand from "./commands/votacao.js";
import * as steamCommand from "./commands/steam.js";
import * as wipeCommand from "./commands/wipe.js";
import * as testeftpCommand from "./commands/testeftp.js";
import * as enviarjsonCommand from "./commands/enviarjson.js";
import * as wipedatasCommand from "./commands/wipedatas.js";
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
commands.set(banpreventivoCommand.data.name, banpreventivoCommand);
commands.set(kickarCommand.data.name, kickarCommand);
commands.set(muteCommand.data.name, muteCommand);
commands.set(unmuteCommand.data.name, unmuteCommand);
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
commands.set(votacaoCommand.data.name, votacaoCommand);
commands.set(steamCommand.data.name, steamCommand);
commands.set(wipeCommand.data.name, wipeCommand);
commands.set(testeftpCommand.data.name, testeftpCommand);
commands.set(enviarjsonCommand.data.name, enviarjsonCommand);
commands.set(wipedatasCommand.data.name, wipedatasCommand);

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
    startRconSync(); startBanExpiryChecker(c); startStatusUpdater(c); startSlotManager(c); startLeaderboardChannel(c); setupRconEventBridge(c); startVipExpiryChecker(c); wipedatasCommand.startWipeDatesUpdater(c); await startBoosterSystem(c);
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
  const host = "jogar.guerrafriarust.com.br"; const gamePort = "28015";
  await interaction.reply({ embeds: [{ color: 0x2ecc71, title: "🎮  Conectar ao Servidor", description: `Clique no link abaixo ou cole no console do jogo (F1):\n\n**\`steam://connect/${host}:${gamePort}\`**\n\nF1 → \`client.connect ${host}:${gamePort}\``, footer: { text: "Guerra Fria" } }], ephemeral: true });
}

async function registerSlashCommands(client: Client): Promise<void> {
  const clientId = process.env.DISCORD_CLIENT_ID; const guildId = process.env.DISCORD_GUILD_ID;
  if (!clientId) { logger.warn("DISCORD_CLIENT_ID not set"); return; }
  const commandData = [banirCommand, banpreventivoCommand, kickarCommand, muteCommand, unmuteCommand, verificarCommand, desbanirCommand, criarsorteioCommand, listvipsCommand, meuvipCommand, ajudaCommand, ticketlogsCommand, darvipCommand, removervipCommand, removerboosterCommand, leaderboardCommand, listaplayerCommand, resetleaderboardCommand, criarmapaCommand, votacaoCommand, steamCommand, wipeCommand, testeftpCommand, enviarjsonCommand, wipedatasCommand].map(c => c.data.toJSON());
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
  recentChatMessages.set(key, now);
  if (recentChatMessages.size > 500) for (const [k, ts] of recentChatMessages) if (now - ts > 60000) recentChatMessages.delete(k);
  return false;
}

async function handleChatEvent(client: Client, raw: string): Promise<void> {
  try {
    const p = JSON.parse(raw) as RustChatPayload;
    if (p.Channel !== 0 || !p.Message || isDuplicateChat(p)) return;
    const channelId = process.env.DISCORD_CHAT_CHANNEL_ID; if (!channelId) return;
    const channel = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null; if (!channel?.isTextBased()) return;
    const clean = p.Message.replace(/<[^>]*>/g, "").trim(); if (!clean) return;
    await channel.send(`💬 **${p.Username}**: ${clean}`);
  } catch {}
}

async function startRconSync(): Promise<void> {
  setAllOffline().catch(() => {});
  setInterval(async () => {
    try { const players = await getOnlinePlayers(); const onlineIds = new Set(players.map(p => p.steamId)); await setAllOffline(); for (const p of players) await upsertPlayer({ ...p, isOnline: true }); }
    catch (err) { logger.error({ err }, "RCON player sync failed"); }
  }, 15_000).unref();
}

function startBanExpiryChecker(client: Client): void {
  setInterval(async () => {
    try {
      const now = new Date();
      const expired = await db.select().from(modLogsTable).where(and(eq(modLogsTable.action, "BAN"), isNotNull(modLogsTable.banExpiresAt), lte(modLogsTable.banExpiresAt, now))).limit(50);
      for (const ban of expired) {
        const [later] = await db.select().from(modLogsTable).where(and(eq(modLogsTable.steamId, ban.steamId), gt(modLogsTable.id, ban.id))).limit(1);
        if (later) continue;
        await executeRconCommand(`unban ${ban.steamId}`);
        await db.insert(modLogsTable).values({ action: "SYSTEM_UNBAN", steamId: ban.steamId, playerName: ban.playerName, reason: "Banimento temporário expirado", adminId: "SYSTEM", adminName: "Sistema Automático" });
        const logChannelId = process.env.DISCORD_LOG_CHANNEL_ID; if (logChannelId) { const ch = await client.channels.fetch(logChannelId).catch(() => null); if (ch?.isSendable()) await ch.send({ embeds: [buildAutoUnbanEmbed(ban.playerName, ban.steamId)] }); }
      }
    } catch (err) { logger.error({ err }, "Ban expiry checker failed"); }
  }, 60_000).unref();
}

function startStatusUpdater(client: Client): void {
  setInterval(async () => {
    try {
      const channelId = process.env.DISCORD_STATUS_CHANNEL_ID; if (!channelId) return;
      const ch = await client.channels.fetch(channelId).catch(() => null); if (!ch?.isTextBased()) return;
      const info = await getServerInfo(); const embed = buildStatusEmbed(info); const components = [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("status_connect").setLabel("Conectar ao Servidor").setEmoji("🎮").setStyle(ButtonStyle.Success))];
      const msgs = await (ch as TextChannel).messages.fetch({ limit: 10 }); const existing = msgs.find(m => m.author.id === client.user?.id && m.embeds[0]?.title?.includes("Status"));
      if (existing) await existing.edit({ embeds: [embed], components }); else await (ch as TextChannel).send({ embeds: [embed], components });
    } catch (err) { logger.error({ err }, "Status updater failed"); }
  }, 60_000).unref();
}
