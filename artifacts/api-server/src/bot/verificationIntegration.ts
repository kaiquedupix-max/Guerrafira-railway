import {
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
let started = false;

const telarData = new SlashCommandBuilder()
  .setName("telar")
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

async function registerTelarCommand(client: Client): Promise<void> {
  // O index principal usa guild.commands.set(), que substitui toda a lista.
  // Esperamos esse registro terminar e então garantimos /telar; se houver corrida,
  // as tentativas seguintes recriam o comando.
  await sleep(5_000);

  const payload = telarData.toJSON();
  const guildId = process.env.DISCORD_GUILD_ID;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      if (guildId) {
        const guild = await client.guilds.fetch(guildId);
        const current = await guild.commands.fetch();
        const existing = current.find(command => command.name === telarData.name);
        if (existing) await existing.edit(payload);
        else await guild.commands.create(payload);

        await sleep(1_500);
        const verified = await guild.commands.fetch();
        if (verified.some(command => command.name === telarData.name)) {
          logger.info({ guildId }, "Slash command /telar registered");
          return;
        }
      } else {
        const current = await client.application?.commands.fetch();
        const existing = current?.find(command => command.name === telarData.name);
        if (existing) await existing.edit(payload);
        else await client.application?.commands.create(payload);

        await sleep(1_500);
        const verified = await client.application?.commands.fetch();
        if (verified?.some(command => command.name === telarData.name)) {
          logger.info("Global slash command /telar registered");
          return;
        }
      }
    } catch (error) {
      logger.error({ error, attempt }, "Failed to register /telar");
    }

    await sleep(2_000);
  }

  logger.error("Could not keep /telar registered after retries");
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

async function executeTelar(interaction: ChatInputCommandInteraction): Promise<void> {
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

  await interaction.editReply(
    `🚨 Telagem iniciada em **${target.name}** (\`${steamId}\`).\n` +
    "O jogador foi imobilizado e recebeu o aviso de verificação no Rust.",
  );
}

type VerificationEvent = {
  eventType?: string;
  steamId?: string;
  playerName?: string;
  reason?: string;
  administrator?: string;
};

const handledRefusals = new Map<string, number>();

function alreadyHandled(steamId: string): boolean {
  const now = Date.now();
  const previous = handledRefusals.get(steamId);
  handledRefusals.set(steamId, now);

  for (const [savedId, timestamp] of handledRefusals) {
    if (now - timestamp > 60_000) handledRefusals.delete(savedId);
  }

  return previous !== undefined && now - previous < 15_000;
}

async function handleVerificationEvent(type: string, message: string): Promise<void> {
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

  if (payload.eventType !== "refusal_ban") return;

  const steamId = String(payload.steamId ?? "").trim();
  if (!STEAM_ID_RE.test(steamId) || alreadyHandled(steamId)) return;

  const playerName = String(payload.playerName ?? `Jogador ${steamId}`).trim().slice(0, 100);
  const reason = String(payload.reason ?? "Recusou a verificação administrativa.").trim().slice(0, 300);

  try {
    // Reutiliza exatamente o fluxo oficial de ban do bot:
    // ban feed, mod_logs e anúncio padrão no servidor.
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
      if (interaction.isAutocomplete() && interaction.commandName === telarData.name) {
        await autocomplete(interaction);
        return;
      }

      if (interaction.isChatInputCommand() && interaction.commandName === telarData.name) {
        await executeTelar(interaction);
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
    handleVerificationEvent(type, message).catch(error =>
      logger.error({ error }, "Verification RCON event handler failed"),
    );
  });

  registerTelarCommand(client).catch(error =>
    logger.error({ error }, "Verification slash registration failed"),
  );
}
