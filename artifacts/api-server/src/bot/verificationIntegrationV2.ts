import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Message,
  type TextChannel,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { addRconEventHandler, executeRconCommand, getOnlinePlayers } from "./utils/rcon.js";
import { searchPlayers } from "./utils/players.js";

const STEAM_ID_RE = /^7656119\d{10}$/;
const EVENT_PREFIX = "[GF_VERIFICACAO]";
const TIMEOUT_BAN_PREFIX = "verification_timeout_ban:";
const TIMEOUT_KEEP_PREFIX = "verification_timeout_keep:";
const INSTRUCTIONS_MARKER = "GF_VORKEN_VERIFICATION_INSTRUCTIONS_V1";
let started = false;
let actionPollBusy = false;

export const data = new SlashCommandBuilder()
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

function safeGameChat(value: string, max = 90): string {
  return String(value ?? "")
    .replace(/[<>\r\n\t;"'\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeCode(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

function vorkenBaseUrl(): string {
  return String(
    process.env.VORKEN_BASE_URL ||
    "https://vorkenac.guerrafriarust.com.br"
  ).replace(/\/$/, "");
}

function integrationKey(): string {
  return String(process.env.VORKEN_GF_INTEGRATION_KEY || "").trim();
}

async function vorkenRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
  } = {},
): Promise<T> {
  const key = integrationKey();
  if (!key) throw new Error("VORKEN_GF_INTEGRATION_KEY não configurada.");

  const response = await fetch(vorkenBaseUrl() + path, {
    method: options.method || "GET",
    headers: {
      "x-vorken-integration-key": key,
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: options.body !== undefined
      ? JSON.stringify(options.body)
      : undefined,
  });

  const data = await response.json().catch(() => ({})) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(
      String(
        data.message ||
        data.error ||
        `Vorken HTTP ${response.status}`
      )
    );
  }

  return data as T;
}

type VerificationEvent = {
  eventType?: string;
  steamId?: string;
  playerName?: string;
  reason?: string;
  administrator?: string;
  code?: string;
  ttlSeconds?: number;
};

type PendingTimeout = {
  steamId: string;
  playerName: string;
  administratorId: string;
  reason: string;
  createdAt: number;
};

type RedeemResponse = {
  ok: boolean;
  analysisId: number;
  publicLink: string;
  steamId: string;
  playerName: string;
  administratorId?: string | null;
};

type VorkenQueuedAction = {
  id: number;
  analysisId: number;
  steamId: string;
  discordUserId?: string | null;
  ticketChannelId?: string | null;
  action: "ban" | "release";
  reason: string;
};

const handledRefusals = new Map<string, number>();
const pendingTimeouts = new Map<string, PendingTimeout>();

function discordAdministratorId(value?: string): string | null {
  const raw = String(value ?? "").trim();
  if (!raw.toLowerCase().startsWith("discord:")) return null;
  const id = raw.slice("discord:".length).trim();
  return /^\d{16,20}$/.test(id) ? id : null;
}

function verificationChannelId(): string {
  return String(process.env.DISCORD_VERIFICATION_CHANNEL_ID || "").trim();
}

function verificationStaffRoleIds(): string[] {
  const raw = [
    process.env.DISCORD_VERIFICATION_STAFF_ROLE_IDS,
    process.env.DISCORD_MODERATOR_ROLE_IDS,
    process.env.DISCORD_ADMIN_ROLE_ID,
  ]
    .filter(Boolean)
    .join(",");

  return [...new Set(
    raw
      .split(/[;,\s]+/)
      .map(value => value.trim())
      .filter(value => /^\d{16,20}$/.test(value))
  )];
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
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

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
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

  const result = await executeRconCommand(
    `verificacao.bot ${steamId} ${interaction.user.id}`
  );

  if (result === null) {
    await interaction.editReply(
      "❌ O servidor Rust não confirmou o comando. Confira o RCON e o plugin Verificacao."
    );
    return;
  }

  const playerName = safeGameChat(target.name, 80) || steamId;
  const administratorName = safeGameChat(
    interaction.user.globalName ??
    interaction.user.username ??
    interaction.user.tag ??
    "Administrador",
    60,
  ) || "Administrador";

  await executeRconCommand(
    `say <color=#FF2222>[VERIFICAÇÃO]</color> Foi iniciado um processo de verificação administrativa com o jogador <color=#FF5555>${playerName}</color>. Administrador responsável: <color=#FFD166>${administratorName}</color>.`
  );

  await interaction.editReply(
    `🚨 Telagem iniciada em **${target.name}** (\`${steamId}\`).\n` +
    "O jogador recebeu na tela um código individual. Ele deve entrar no canal de verificação do Discord e enviar esse código. " +
    "O ticket privado e a análise Vorken serão criados automaticamente."
  );
}

async function registerVorkenSession(payload: VerificationEvent): Promise<void> {
  const steamId = String(payload.steamId || "").trim();
  const code = normalizeCode(payload.code);
  if (!STEAM_ID_RE.test(steamId) || !/^[A-Z0-9]{6,12}$/.test(code)) return;

  await vorkenRequest("/api/integrations/guerra-fria/session", {
    method: "POST",
    body: {
      code,
      steamId,
      playerName: String(payload.playerName || steamId).slice(0, 100),
      administratorId: discordAdministratorId(payload.administrator) || undefined,
      ttlSeconds: Math.max(120, Math.min(3600, Number(payload.ttlSeconds || 600))),
    },
  });

  logger.info({ steamId, code }, "Vorken verification session registered");
}

async function cancelVorkenSession(code?: string): Promise<void> {
  const normalized = normalizeCode(code);
  if (!/^[A-Z0-9]{6,12}$/.test(normalized)) return;

  await vorkenRequest(
    `/api/integrations/guerra-fria/session/${encodeURIComponent(normalized)}/cancel`,
    { method: "POST", body: {} },
  ).catch(() => {});
}

async function ensureVerificationInstructions(client: Client): Promise<void> {
  const channelId = verificationChannelId();
  if (!channelId) {
    logger.warn("DISCORD_VERIFICATION_CHANNEL_ID not set; verification code channel disabled");
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) {
    logger.warn({ channelId }, "Verification channel not available");
    return;
  }

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = recent?.find(message =>
    message.author.id === client.user?.id &&
    message.embeds.some(embed => embed.footer?.text === INSTRUCTIONS_MARKER)
  );

  const embed = new EmbedBuilder()
    .setColor(0x2bf0c9)
    .setTitle("🛡️ Verificação Vorken • Guerra Fria")
    .setDescription(
      "**Se você foi chamado para verificação dentro do Rust:**\n\n" +
      "1. Veja o **código** exibido na tela do jogo.\n" +
      "2. Envie **somente o código** neste canal.\n" +
      "3. O bot criará uma **sala privada** para sua verificação.\n" +
      "4. Dentro da sala você receberá seu **link exclusivo do Vorken**.\n" +
      "5. Baixe, execute e aguarde a análise terminar.\n\n" +
      "⚠️ Não compartilhe seu código. Não desconecte do servidor durante a verificação."
    )
    .setFooter({ text: INSTRUCTIONS_MARKER });

  if (existing) {
    await existing.edit({ embeds: [embed] }).catch(() => {});
  } else {
    await channel.send({ embeds: [embed] });
  }
}

function ticketName(playerName: string, steamId: string): string {
  const base = playerName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 38) || "jogador";

  return `verificacao-${base}-${steamId.slice(-4)}`.slice(0, 90);
}

async function createVerificationTicket(
  message: Message,
  session: RedeemResponse,
  code: string,
): Promise<TextChannel> {
  if (!message.guild) throw new Error("A verificação deve ser enviada dentro do servidor Discord.");

  const guild = message.guild;
  const botId = message.client.user?.id;
  if (!botId) throw new Error("Bot indisponível.");

  const staffIds = verificationStaffRoleIds()
    .filter(id => guild.roles.cache.has(id));

  const permissionOverwrites = [
    {
      id: guild.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: message.author.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
      ],
    },
    ...staffIds.map(id => ({
      id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    })),
  ];

  if (session.administratorId &&
      /^\d{16,20}$/.test(session.administratorId) &&
      session.administratorId !== message.author.id) {
    permissionOverwrites.push({
      id: session.administratorId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  const channel = await guild.channels.create({
    name: ticketName(session.playerName, session.steamId),
    type: ChannelType.GuildText,
    parent: process.env.DISCORD_VERIFICATION_CATEGORY_ID?.trim() || undefined,
    topic:
      `Vorken • ${session.playerName} • ${session.steamId} • análise #${session.analysisId}`,
    permissionOverwrites,
  });

  if (channel.type !== ChannelType.GuildText) {
    throw new Error("Não foi possível criar a sala de verificação.");
  }

  await vorkenRequest(
    `/api/integrations/guerra-fria/session/${encodeURIComponent(code)}/ticket`,
    {
      method: "POST",
      body: { ticketChannelId: channel.id },
    },
  );

  await executeRconCommand(
    `verificacao atender ${session.steamId}`
  );

  const embed = new EmbedBuilder()
    .setColor(0x2bf0c9)
    .setTitle("Vorken • Análise criada")
    .setDescription(
      `A verificação de **${session.playerName}** foi vinculada com sucesso.\n\n` +
      "**Passos:**\n" +
      "1. Abra o link abaixo.\n" +
      "2. Baixe o **Vorken.exe**.\n" +
      "3. Execute como administrador.\n" +
      "4. Mantenha o Rust aberto e aguarde a análise concluir.\n" +
      "5. Aguarde a decisão da equipe nesta sala."
    )
    .addFields(
      { name: "SteamID", value: `\`${session.steamId}\``, inline: true },
      { name: "Análise", value: `#${session.analysisId}`, inline: true },
      { name: "Link exclusivo", value: `[Abrir e baixar Vorken](${session.publicLink})` },
    )
    .setFooter({ text: "Guerra Fria • Verificação privada" })
    .setTimestamp();

  await channel.send({
    content: `<@${message.author.id}>`,
    embeds: [embed],
    allowedMentions: { users: [message.author.id] },
  });

  return channel;
}

export async function handleVerificationCodeMessage(message: Message): Promise<boolean> {
  if (message.author.bot || !message.guild) return false;

  const channelId = verificationChannelId();
  if (!channelId || message.channelId !== channelId) return false;

  const code = normalizeCode(message.content);
  if (!/^[A-Z0-9]{6,12}$/.test(code)) return false;

  await message.delete().catch(() => {});

  try {
    const session = await vorkenRequest<RedeemResponse>(
      "/api/integrations/guerra-fria/session/redeem",
      {
        method: "POST",
        body: {
          code,
          discordUserId: message.author.id,
        },
      },
    );

    const ticket = await createVerificationTicket(message, session, code);

    const confirmation = await message.channel.send({
      content:
        `<@${message.author.id}> ✅ Código aceito. Sua sala privada foi criada: <#${ticket.id}>`,
      allowedMentions: { users: [message.author.id] },
    }).catch(() => null);

    if (confirmation) {
      setTimeout(() => confirmation.delete().catch(() => {}), 15_000);
    }
  } catch (error) {
    logger.warn(
      { error, userId: message.author.id, code },
      "Verification code redeem failed",
    );

    const reply = await message.channel.send({
      content:
        `<@${message.author.id}> ❌ ${error instanceof Error ? error.message : "Código inválido ou expirado."}`,
      allowedMentions: { users: [message.author.id] },
    }).catch(() => null);

    if (reply) setTimeout(() => reply.delete().catch(() => {}), 15_000);
  }

  return true;
}

function alreadyHandled(steamId: string): boolean {
  const now = Date.now();
  const previous = handledRefusals.get(steamId);
  handledRefusals.set(steamId, now);

  for (const [savedId, timestamp] of handledRefusals) {
    if (now - timestamp > 60_000) handledRefusals.delete(savedId);
  }

  return previous !== undefined && now - previous < 15_000;
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
  const reason = String(
    payload.reason ??
    "Não compareceu à verificação administrativa dentro do prazo de 5 minutos."
  ).trim().slice(0, 300);

  pendingTimeouts.set(steamId, {
    steamId,
    playerName,
    administratorId,
    reason,
    createdAt: Date.now(),
  });

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
        "⏰ **O prazo da telagem expirou.**\n\n" +
        `Jogador: **${playerName}**\n` +
        `SteamID: \`${steamId}\`\n\n` +
        "Deseja aplicar banimento permanente por não comparecimento?",
      components: [row],
    });
  } catch (error) {
    logger.error({ error, steamId, administratorId }, "Failed to DM verification timeout");
  }
}

async function handleTimeoutButton(interaction: any): Promise<boolean> {
  if (!interaction.isButton?.()) return false;

  const customId = String(interaction.customId ?? "");
  const isBan = customId.startsWith(TIMEOUT_BAN_PREFIX);
  const isKeep = customId.startsWith(TIMEOUT_KEEP_PREFIX);
  if (!isBan && !isKeep) return false;

  const steamId = customId.slice(
    (isBan ? TIMEOUT_BAN_PREFIX : TIMEOUT_KEEP_PREFIX).length
  );
  const pending = pendingTimeouts.get(steamId);

  if (!pending) {
    await interaction.update({
      content: "ℹ️ Esta decisão não está mais pendente.",
      components: [],
    }).catch(() => {});
    return true;
  }

  if (interaction.user.id !== pending.administratorId) {
    await interaction.reply({
      content: "❌ Somente o administrador que iniciou a telagem pode decidir este caso.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  if (isKeep) {
    pendingTimeouts.delete(steamId);
    await interaction.update({
      content:
        `⏳ **${pending.playerName}** continuará preso na verificação até a decisão final.`,
      components: [],
    });
    return true;
  }

  await interaction.deferUpdate();

  try {
    const { banPlayer } = await import("../core/systemActions.js");

    // Libera a sessão antes do ban para evitar que o kick seja classificado
    // pelo plugin como uma segunda evasão.
    await executeRconCommand(`verificacao liberar ${steamId}`);

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

    pendingTimeouts.delete(steamId);

    await interaction.editReply({
      content:
        `🔨 Banimento permanente aplicado em **${result.playerName}** (\`${steamId}\`).`,
      components: [],
    });
  } catch (error) {
    logger.error({ error, steamId }, "Failed verification timeout ban");
    await interaction.editReply({
      content: "❌ Não foi possível aplicar o banimento.",
      components: [],
    }).catch(() => {});
  }

  return true;
}

async function notifyActionTicket(
  client: Client,
  action: VorkenQueuedAction,
  message: string,
  success: boolean,
): Promise<void> {
  const channelId = String(action.ticketChannelId || "");
  if (!/^\d{16,20}$/.test(channelId)) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return;

  const mention = /^\d{16,20}$/.test(String(action.discordUserId || ""))
    ? `<@${action.discordUserId}>`
    : "";

  await channel.send({
    content:
      `${mention ? mention + "\n" : ""}` +
      (success ? "✅ " : "❌ ") +
      message,
    allowedMentions: mention
      ? { users: [String(action.discordUserId)] }
      : { parse: [] },
  }).catch(() => {});
}

async function processVorkenAction(client: Client, action: VorkenQueuedAction): Promise<void> {
  let success = false;
  let resultText = "";

  try {
    if (!STEAM_ID_RE.test(action.steamId)) {
      throw new Error("SteamID inválido na decisão.");
    }

    if (action.action === "release") {
      const result = await executeRconCommand(
        `verificacao liberar ${action.steamId}`
      );

      if (result === null) {
        throw new Error("Servidor não confirmou a liberação.");
      }

      success = true;
      resultText = "Jogador liberado da verificação.";

      await notifyActionTicket(
        client,
        action,
        "A análise foi concluída e o jogador foi **liberado** pela administração.",
        true,
      );
    } else if (action.action === "ban") {
      const { banPlayer } = await import("../core/systemActions.js");

      await executeRconCommand(
        `verificacao liberar ${action.steamId}`
      );

      const result = await banPlayer({
        steamId: action.steamId,
        duration: "perm",
        reason:
          action.reason ||
          "Trapaça confirmada na verificação Vorken.",
        actor: {
          id: "VORKEN",
          name: "Painel Vorken",
          source: "system",
        },
      });

      success = true;
      resultText =
        `Banimento permanente aplicado a ${result.playerName}.`;

      await notifyActionTicket(
        client,
        action,
        `A análise foi concluída e o jogador foi **banido permanentemente**.\nMotivo: **${action.reason || "Trapaça confirmada na verificação Vorken."}**`,
        true,
      );
    } else {
      throw new Error("Ação desconhecida.");
    }
  } catch (error) {
    resultText =
      error instanceof Error
        ? error.message
        : "Falha desconhecida.";

    await notifyActionTicket(
      client,
      action,
      `Falha ao aplicar a decisão da análise: ${resultText}`,
      false,
    );
  }

  await vorkenRequest(
    `/api/integrations/guerra-fria/actions/${action.id}/complete`,
    {
      method: "POST",
      body: {
        success,
        result: success ? resultText : undefined,
        error: success ? undefined : resultText,
      },
    },
  ).catch(error =>
    logger.error({ error, actionId: action.id }, "Failed to acknowledge Vorken action")
  );
}

async function pollVorkenActions(client: Client): Promise<void> {
  if (actionPollBusy || !integrationKey()) return;
  actionPollBusy = true;

  try {
    const data = await vorkenRequest<{ action: VorkenQueuedAction | null }>(
      "/api/integrations/guerra-fria/actions/next"
    );

    if (data.action) {
      await processVorkenAction(client, data.action);
    }
  } catch (error) {
    logger.warn({ error }, "Vorken action poll failed");
  } finally {
    actionPollBusy = false;
  }
}

async function handleVerificationEvent(
  client: Client,
  type: string,
  message: string,
): Promise<void> {
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

  if (payload.eventType === "session_started") {
    await registerVorkenSession(payload).catch(async error => {
      logger.error({ error, steamId, code: payload.code }, "Failed to register Vorken verification session");

      const administratorId = discordAdministratorId(payload.administrator);
      if (administratorId) {
        const user = await client.users.fetch(administratorId).catch(() => null);
        await user?.send(
          "❌ A telagem começou no Rust, mas o Vorken não conseguiu registrar o código. Verifique VORKEN_BASE_URL e VORKEN_GF_INTEGRATION_KEY."
        ).catch(() => {});
      }
    });
    return;
  }

  if (payload.eventType === "timeout_prompt") {
    await sendTimeoutPrompt(client, payload);
    return;
  }

  if (payload.eventType === "session_end") {
    if (STEAM_ID_RE.test(steamId)) pendingTimeouts.delete(steamId);
    await cancelVorkenSession(payload.code);
    return;
  }

  if (payload.eventType !== "refusal_ban") return;
  if (!STEAM_ID_RE.test(steamId) || alreadyHandled(steamId)) return;

  pendingTimeouts.delete(steamId);
  await cancelVorkenSession(payload.code);

  const playerName = String(
    payload.playerName ??
    `Jogador ${steamId}`
  ).trim().slice(0, 100);

  const reason = String(
    payload.reason ??
    "Recusou a verificação administrativa."
  ).trim().slice(0, 300);

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
  } catch (error) {
    logger.error({ error, steamId, playerName }, "Failed to synchronize verification refusal ban");
  }
}

export function startVerificationIntegration(client: Client): void {
  if (started) return;
  started = true;

  ensureVerificationInstructions(client).catch(error =>
    logger.error({ error }, "Failed to publish verification instructions")
  );

  client.on(Events.InteractionCreate, async interaction => {
    try {
      if (await handleTimeoutButton(interaction)) return;
    } catch (error) {
      logger.error({ error }, "Verification interaction failed");
    }
  });

  addRconEventHandler((type, message) => {
    handleVerificationEvent(client, type, message).catch(error =>
      logger.error({ error }, "Verification RCON event handler failed")
    );
  });

  setInterval(
    () => pollVorkenActions(client).catch(() => {}),
    4000,
  );

  pollVorkenActions(client).catch(() => {});
}
