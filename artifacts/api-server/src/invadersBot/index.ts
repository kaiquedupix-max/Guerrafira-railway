import {
  ActivityType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { buildInscritosEmbed, buildPreviaEmbed, loadTotals, type Totals } from "../bot/commands/invaders.js";

// Sub bot "Guerra Fria Invaders": aplicação própria no Discord, com token próprio (INVADERS_BOT_TOKEN).
// Mostra inscritos e informações do evento, e mantém um painel que se atualiza sozinho no canal configurado.

const PANEL_TITLE = "Base Invaders • Painel ao vivo";
const SITE_URL = "https://www.guerrafriarust.com.br/base-invaders";
const PANEL_INTERVAL_MS = 5 * 60 * 1000;

const command = new SlashCommandBuilder()
  .setName("invaders")
  .setDescription("Base Invaders: inscritos, prévia do sorteio e informações do evento.")
  .addSubcommand(sub => sub.setName("inscritos").setDescription("Quantas equipes e jogadores já estão inscritos."))
  .addSubcommand(sub => sub.setName("previa-sorteio").setDescription("Quantos trios sairiam com os inscritos solo."))
  .addSubcommand(sub => sub.setName("info").setDescription("Formato, fases e como se inscrever."));

function buildPainelEmbed(t: Totals): EmbedBuilder {
  const trioTeams = t.trioTeamsPending + t.trioTeamsApproved;
  const solo = t.soloPending + t.soloApproved;
  const atualizado = Math.floor(Date.now() / 1000);
  return new EmbedBuilder()
    .setColor(0xffb800)
    .setTitle(PANEL_TITLE)
    .setDescription(`Inscrições gratuitas em trio ou solo. Atualizado <t:${atualizado}:R>.`)
    .addFields(
      { name: "Equipes em trio", value: `**${trioTeams}** (${t.trioTeamsApproved} aprovadas)`, inline: true },
      { name: "Jogadores em trio", value: `**${t.trioPlayers}**`, inline: true },
      { name: "Inscritos solo", value: `**${solo}**`, inline: true },
      { name: "Fases", value: "Build 90 min • PVP 90 min • Raid 120 min" },
      { name: "Inscrição", value: `[Inscreva-se no site](${SITE_URL})` },
    );
}

function buildInfoEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xffb800)
    .setTitle("Base Invaders • Informações")
    .setDescription("Evento de 5 horas, em trios de 3 jogadores. Sem taxa de inscrição.")
    .addFields(
      { name: "Fases", value: "Build/Farm 90 min • PVP 90 min • Raid 120 min" },
      { name: "Formato", value: "Trio fechado (time já pronto) ou inscrição solo. Os solos são sorteados em trios no dia do evento." },
      { name: "Pontuação", value: "Kill +1 • TC destruído +40 • Bradley/Heli +3 • Hackable +10 • Defesa de raid até +40" },
      { name: "Inscrição", value: `[Inscreva-se no site](${SITE_URL})` },
    );
}

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const ephemeral = sub === "previa-sorteio";
  await interaction.deferReply({ ephemeral });
  try {
    if (sub === "info") {
      await interaction.editReply({ embeds: [buildInfoEmbed()] });
      return;
    }
    const totals = await loadTotals();
    const embed = sub === "previa-sorteio" ? buildPreviaEmbed(totals) : buildInscritosEmbed(totals);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error({ error, subcommand: sub }, "Falha no sub bot Guerra Fria Invaders");
    await interaction.editReply("Não consegui consultar as inscrições agora. Tente de novo em instantes.");
  }
}

export async function startInvadersBot(): Promise<void> {
  const token = process.env.INVADERS_BOT_TOKEN;
  if (!token) {
    logger.info("INVADERS_BOT_TOKEN ausente: sub bot Guerra Fria Invaders desativado");
    return;
  }
  const guildId = process.env.DISCORD_GUILD_ID;
  const panelChannelId = process.env.INVADERS_PANEL_CHANNEL_ID;

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  let panel: Message | null = null;

  async function updatePanel(): Promise<void> {
    if (!panelChannelId) return;
    const channel = await client.channels.fetch(panelChannelId);
    if (!channel?.isTextBased() || channel.isDMBased()) {
      logger.warn({ panelChannelId }, "Canal do painel Invaders não é de texto");
      return;
    }
    const embed = buildPainelEmbed(await loadTotals());
    if (!panel && client.user) {
      const recent = await channel.messages.fetch({ limit: 25 });
      panel = recent.find(m => m.author.id === client.user?.id && m.embeds[0]?.title === PANEL_TITLE) ?? null;
    }
    if (panel) await panel.edit({ embeds: [embed] });
    else panel = await channel.send({ embeds: [embed] });
  }

  client.once(Events.ClientReady, async ready => {
    logger.info({ tag: ready.user.tag }, "Guerra Fria Invaders online");
    client.user?.setActivity("Base Invaders", { type: ActivityType.Watching });
    if (guildId) {
      // Se o bot ainda não estiver no servidor, o registro falha aqui sem derrubar o processo.
      try {
        const guild = await client.guilds.fetch(guildId);
        await guild.commands.set([command.toJSON()]);
        logger.info({ guildId }, "Comando /invaders do sub bot registrado");
      } catch (error) {
        logger.error({ error, guildId }, "Não foi possível registrar /invaders: o bot está no servidor?");
      }
    }
    if (panelChannelId) {
      await updatePanel().catch(error => logger.error({ error }, "Falha ao atualizar o painel Invaders"));
      setInterval(() => {
        updatePanel().catch(error => logger.error({ error }, "Falha ao atualizar o painel Invaders"));
      }, PANEL_INTERVAL_MS);
    }
  });

  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "invaders") return;
    await handleCommand(interaction);
  });

  await client.login(token);
}
