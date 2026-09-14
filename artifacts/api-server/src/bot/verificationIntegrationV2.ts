import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { addRconEventHandler, executeRconCommand, getOnlinePlayers } from "./utils/rcon.js";
import { searchPlayers } from "./utils/players.js";

const STEAM_ID_RE = /^7656119\d{10}$/;
const EVENT_PREFIX = "[GF_VERIFICACAO]";
const TIMEOUT_BAN_PREFIX = "verification_timeout_ban:";
const TIMEOUT_KEEP_PREFIX = "verification_timeout_keep:";
let started = false;

const telagemData = new SlashCommandBuilder()
  .setName("telagem")
  .setDescription("Inicia uma telagem/verificação administrativa em um jogador online")
  .addStringOption(opt =>
    opt
      .setName("jogador")
      .setDescription("Jogador online (nome ou SteamID64)")
      .setRequired(true)
      .setAutocomplete(true),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function safeGameChat(value: string, max = 90): string {
  return String(value ?? "")
    .replace(/[<>\r\n\t;"'\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

async function registerTelagemCommand(client: Client): Promise<void> {
  await sleep(5_000);

  const payload = telagemData.toJSON();
  const guildId = process.env.DISCORD_GUILD_ID;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      if (guildId) {
        const guild = await client.guilds.fetch(guildId);
        const current = await guild.commands.fetch();
        const legacy = current.find(command => command.name === "telar");
        if (legacy) await legacy.delete().catch(() => {});

        const existing = current.find(command => command.name === telagemData.name);
        if (existing) await existing.edit(payload);
        else await guild.commands.create(payload);

        await sleep(1_500);
        const verified = await guild.commands.fetch();
        if (verified.some(command => command.name === telagemData.name)) {
          logger.info({ guildId }, "Slash command /telagem registered");
          return;
        }
      } else {
        const current = await client.application?.commands.fetch();
        const legacy = current?.find(command => command.name === "telar");
        if (legacy) await legacy.delete().catch(() => {});

        const existing = current?.find(command => command.name === telagemData.name);
        if (existing) await existing.edit(payload);
        else await client.application?.commands.create(payload);

        await sleep(1_500);
        const verified = await client.application?.commands.fetch();
        if (verified?.some(command => command.name === telagemData.name)) {
          logger.info("Global slash command /telagem registered");
          return;
        }
      }
    } catch (error) {
      logger.error({ error, attempt }, "Failed to register /telagem");
    }

    await sleep(2_000);
  }

  logger.error("Could not keep /telagem registered after retries");
}

async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().trim();
  const players = await searchPlayers(focused, 25);
  const online = players.filter(player => player.isOnline);

  await interaction.respond(
    online.slice(0, 25).map(player => ({
      name: `🟢 ONLINE • ${player.playerName} — ${player.steamId}`.slice(0, 100),
      value: player.steamId,
    })),
  );
}

async function executeTelagem(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const steamId = interaction.options.getString("jogador", true).trim();
  if (!STEAM_ID_RE.test(steamId)) {
    await interaction.editReply("❌ SteamID64 inválido.");
    return;
  }

  const onlinePlayers = await getOnlinePlayers();
  const target = onlinePlayers.find(player => player.steamId === steamId);
  if (!target) {
    await interaction.editReply("❌ O jogador precisa estar online para iniciar a telagem.");
    return;
  }

  const result = await executeRconCommand(`verificacao.bot ${steamId} ${interaction.user.id}`);
  if (result === null) {
    await interaction.editReply("❌ O servidor Rust não confirmou o comando. Confira o RCON e o plugin Verificacao.");
    return;
  }

  const playerName = safeGameChat(target.name, 80) || steamId;
  const administratorName = safeGameChat(
    interaction.user.globalName ?? interaction.user.username ?? interaction.user.tag ?? "Administrador",
    60,
  ) || "Administrador";

  const announcement = await executeRconCommand(
    `say <color=#FF2222>[VERIFICAÇÃO]</color> Foi iniciado um processo de verificação administrativa com o jogador <color=#FF5555>${playerName}</color>. Administrador responsável: <color=#FFD166>${administratorName}</color>.`,
  );
  if (announcement === null) {
    logger.warn(
      { steamId, playerName, administratorId: interaction.user.id, administratorName },
      "Telagem started but public Rust chat announcement was not confirmed",
    );
  }

  await interaction.editReply(
    `🚨 Telagem iniciada em **${target.name}** (\`${steamId}\`).\n` +
    `Administrador responsável: **${interaction.user.tag ?? interaction.user.username}**.\n` +
    "O jogador foi imobilizado e a tela dele permanece totalmente preta durante o processo. O servidor foi avisado no chat.",
  );
}

type VerificationEvent = {
  eventType?: string;
  steamId?: string;
  playerName?: string;
  reason?: string;
  administrator?: string;
};

type PendingTimeout = {
  steamId: string;
  playerName: string;
  administratorId: string;
  reason: string;
  createdAt: number;
};

const handledRefusals = new Map<string, number>();
const pendingTimeouts = new Map<string, PendingTimeout>();

function alreadyHandled(steamId: string): boolean {
  const now = Date.now();
  const previous = handledRefusals.get(steamId);
  handledRefusals.set(steamId, now);

  for (const [savedId, timestamp] of handledRefusals) {
    if (now - timestamp > 60_000) handledRefusals.delete(savedId);
  }

  return previous !== undefined && now - previous < 15_000;
}

function discordAdministratorId(value?: string): string | null {
  const raw = String(value ?? "").trim();
  if (!raw.toLowerCase().startsWith("discord:")) return null;
  const id = raw.slice("discord:".length).trim();
  return /^\d{16,20}$/.test(id) ? id : null;
}

function clearExpiredTimeouts(): void {
  const now = Date.now();
  for (const [steamId, pending] of pendingTimeouts) {
    if (now - pending.createdAt > 60 * 60_000) pendingTimeouts.delete(steamId);
  }
}

async function sendTimeoutPrompt(client: Client, payload: VerificationEvent): Promise<void> {
  const steamId = String(payload.steamId ?? "").trim();
  const administratorId = discordAdministratorId(payload.administrator);
  if (!STEAM_ID_RE.test(steamId) || !administratorId) return;

  clearExpiredTimeouts();
  const playerName = String(payload.playerName ?? `Jogador ${steamId}`).trim().slice(0, 100);
  const reason = String(payload.reason ?? "Não compareceu à verificação administrativa dentro do prazo de 5 minutos.")
    .trim()
    .slice(0, 300);

  const pending: PendingTimeout = {
    steamId,
    playerName,
    administratorId,
    reason,
    createdAt: Date.now(),
  };
  pendingTimeouts.set(steamId, pending);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TIMEOUT_BAN_PREFIX}${steamId}`)
      .setLabel("Banir permanentemente")
      .setEmoji("🔨")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${TIMEOUT_KEEP_PREFIX}${steamId}`)
      .setLabel("Não banir agora")
      .setEmoji("⏳")
      .setStyle(ButtonStyle.Secondary),
  );

  try {
    const administrator = await client.users.fetch(administratorId);
    await administrator.send({
      content:
        `⏰ **O prazo de 5 minutos da telagem expirou.**\n\n` +
        `Administrador que iniciou: **${administrator.tag ?? administrator.username}**\n` +
        `Jogador: **${playerName}**\n` +
        `SteamID: \`${steamId}\`\n\n` +
        "O jogador continua preso na verificação. Deseja aplicar **banimento permanente** por não comparecer dentro do prazo?",
      components: [row],
    });
    logger.info({ steamId, playerName, administratorId }, "Verification timeout DM sent to moderator");
  } catch (error) {
    logger.error({ error, steamId, playerName, administratorId }, "Failed to DM moderator after verification timeout");
  }
}

async function handleTimeoutButton(interaction: any): Promise<boolean> {
  if (!interaction.isButton?.()) return false;

  const customId = String(interaction.customId ?? "");
  const isBan = customId.startsWith(TIMEOUT_BAN_PREFIX);
  const isKeep = customId.startsWith(TIMEOUT_KEEP_PREFIX);
  if (!isBan && !isKeep) return false;

  const steamId = customId.slice((isBan ? TIMEOUT_BAN_PREFIX : TIMEOUT_KEEP_PREFIX).length);
  const pending = pendingTimeouts.get(steamId);

  if (!pending) {
    await interaction.update({
      content: "ℹ️ Esta decisão de telagem não está mais pendente. O jogador pode já ter sido verificado, liberado ou punido.",
      components: [],
    }).catch(() => {});
    return true;
  }

  if (interaction.user.id !== pending.administratorId) {
    await interaction.reply({ content: "❌ Somente o administrador que iniciou a telagem pode decidir este caso.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  if (isKeep) {
    pendingTimeouts.delete(steamId);
    await interaction.update({
      content:
        `⏳ **${pending.playerName}** não foi banido agora.\n` +
        "Ele continuará preso na verificação até você concluir o processo. Use `/verificar` para aprovar e liberar o jogador, ou aplique a punição manualmente se necessário.",
      components: [],
    });
    return true;
  }

  await interaction.deferUpdate();
  try {
    const { banPlayer } = await import("../core/systemActions.js");
    const result = await banPlayer({
      steamId,
      duration: "perm",
      reason: pending.reason,
      playerName: pending.playerName,
      actor: {
        id: interaction.user.id,
        name: interaction.user.tag ?? interaction.user.username ?? "Administrador",
        source: "discord",
      },
    });

    const releaseResult = await executeRconCommand(`verificacao liberar ${steamId}`);
    if (releaseResult === null) {
      logger.warn({ steamId }, "Timeout ban applied but verification session release was not confirmed");
    }

    pendingTimeouts.delete(steamId);
    await interaction.editReply({
      content:
        `🔨 **Banimento permanente aplicado.**\n` +
        `Jogador: **${result.playerName}** (\`${steamId}\`)\n` +
        `Motivo: ${pending.reason}\n\n` +
        "O ban feed e o anúncio padrão do servidor foram acionados.",
      components: [],
    });
  } catch (error) {
    logger.error({ error, steamId, playerName: pending.playerName }, "Failed to apply verification timeout ban");
    await interaction.editReply({
      content: "❌ Não foi possível aplicar o banimento agora. A telagem continua ativa; tente novamente pelo comando de banimento.",
      components: [],
    }).catch(() => {});
  }

  return true;
}

async function handleVerificationEvent(client: Client, type: string, message: string): Promise<void> {
  const index = message.indexOf(EVENT_PREFIX);
  if (index < 0) return;

  const raw = message.slice(index + EVENT_PREFIX.length).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) return;

  let payload: VerificationEvent;
  try {
    payload = JSON.parse(raw.slice(start, end + 1)) as VerificationEvent;
  } catch (error) {
    logger.warn({ error, type, raw }, "Invalid verification RCON event");
    return;
  }

  const steamId = String(payload.steamId ?? "").trim();

  if (payload.eventType === "timeout_prompt") {
    await sendTimeoutPrompt(client, payload);
    return;
  }

  if (payload.eventType === "session_end") {
    if (STEAM_ID_RE.test(steamId)) pendingTimeouts.delete(steamId);
    return;
  }

  if (payload.eventType !== "refusal_ban") return;
  if (!STEAM_ID_RE.test(steamId) || alreadyHandled(steamId)) return;

  pendingTimeouts.delete(steamId);
  const playerName = String(payload.playerName ?? `Jogador ${steamId}`).trim().slice(0, 100);
  const reason = String(payload.reason ?? "Recusou a verificação administrativa.").trim().slice(0, 300);

  try {
    const { banPlayer } = await import("../core/systemActions.js");
    await banPlayer({
      steamId,
      duration: "perm",
      reason,
      playerName,
      actor: {
        id: "SYSTEM",
        name: "Sistema de Verificação",
        source: "system",
      },
    });

    logger.info(
      { steamId, playerName, administrator: payload.administrator ?? null },
      "Verification refusal synchronized with Discord moderation",
    );
  } catch (error) {
    logger.error(
      { error, steamId, playerName, administrator: payload.administrator ?? null },
      "Failed to synchronize verification refusal ban",
    );
  }
}

export function startVerificationIntegration(client: Client): void {
  if (started) return;
  started = true;

  client.on(Events.InteractionCreate, async interaction => {
    try {
      if (await handleTimeoutButton(interaction)) return;

      if (interaction.isAutocomplete() && interaction.commandName === telagemData.name) {
        await autocomplete(interaction);
        return;
      }

      if (interaction.isChatInputCommand() && interaction.commandName === telagemData.name) {
        await executeTelagem(interaction);
      }
    } catch (error) {
      logger.error({ error }, "Verification interaction failed");
      if (interaction.isChatInputCommand()) {
        const message = "❌ Falha ao processar a telagem.";
        if (interaction.deferred || interaction.replied) await interaction.editReply(message).catch(() => {});
        else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });

  addRconEventHandler((type, message) => {
    handleVerificationEvent(client, type, message).catch(error =>
      logger.error({ error }, "Verification RCON event handler failed"),
    );
  });

  registerTelagemCommand(client).catch(error =>
    logger.error({ error }, "Verification slash registration failed"),
  );
}
