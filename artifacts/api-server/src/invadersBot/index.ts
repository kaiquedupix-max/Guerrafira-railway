import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ContainerBuilder,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SlashCommandBuilder,
  TextDisplayBuilder,
  type ChatInputCommandInteraction,
  type Message,
  type MessageCreateOptions,
  type MessageEditOptions,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { buildInscritosEmbed, buildPreviaEmbed, loadTotals, type Totals } from "../bot/commands/invaders.js";

// Sub bot "Guerra Fria Invaders": aplicação própria no Discord, com token próprio (INVADERS_BOT_TOKEN).
// O painel usa Components V2 (container com banner), atualiza sozinho no canal INVADERS_PANEL_CHANNEL_ID.

const SITE_URL = "https://www.guerrafriarust.com.br/base-invaders";
// Banner já publicado no canal #guerra-fria-invaders (Estandarte Dourado), hospedado no GitHub.
const BANNER_URL = "https://raw.githubusercontent.com/vkvucks-ai/guerrafriainvaders/main/Estandarte%20Dourado%20Guerra%20Fria.png";
const ACCENT = 0xffca57;
const PANEL_INTERVAL_MS = 5 * 60 * 1000;

const command = new SlashCommandBuilder()
  .setName("invaders")
  .setDescription("Base Invaders: inscritos, prévia do sorteio e informações do evento.")
  .addSubcommand(sub => sub.setName("inscritos").setDescription("Quantas equipes e jogadores já estão inscritos."))
  .addSubcommand(sub => sub.setName("previa-sorteio").setDescription("Quantos trios sairiam com os inscritos solo."))
  .addSubcommand(sub => sub.setName("info").setDescription("Formato, fases e como se inscrever."));

// JSON v2 (Components V2): um container com banner, contagens ao vivo, cronograma, pontuação e botão de inscrição.
export function buildPainel(t: Totals): ContainerBuilder {
  const trioTeams = t.trioTeamsPending + t.trioTeamsApproved;
  const solo = t.soloPending + t.soloApproved;
  const atualizado = Math.floor(Date.now() / 1000);
  return new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(BANNER_URL).setDescription("Base Invaders")),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("# 🏆 BASE INVADERS\n**Guerra Fria Rust** • Trio • 5 horas • Grátis"))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      "### 📊 Inscrições",
      `🧩 **${trioTeams}** equipes em trio (${t.trioTeamsApproved} aprovadas)`,
      `👥 **${t.trioPlayers}** jogadores em trio`,
      `🎲 **${solo}** solos aguardando o sorteio`,
    ].join("\n")))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      "### 🕐 Cronograma",
      "🔨 **Build/Farm** • 90 min",
      "⚔️ **PVP** • 90 min",
      "💥 **Raid** • 120 min",
    ].join("\n")))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      "### 🏅 Pontuação",
      "☠️ Kill **+1** • 🏰 TC destruído **+40**",
      "📦 Bradley/Heli **+3** • 🔓 Hackable **+10**",
      "🛡️ Defesa de raid **até +40**",
    ].join("\n")))
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setLabel("Inscrever-se grátis").setStyle(ButtonStyle.Link).setURL(SITE_URL).setEmoji("📝"),
      ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Atualizado <t:${atualizado}:R> • atualiza sozinho a cada 5 min`));
}

function buildInfoEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ACCENT)
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
    const container = buildPainel(await loadTotals());
    // discord.js tipa componentes V2 com uma versão de discord-api-types diferente da do builder; o JSON enviado é válido.
    const payload: unknown = { flags: MessageFlags.IsComponentsV2, components: [container.toJSON()] };
    if (!panel && client.user) {
      // Reaproveita o painel já postado pelo bot, para não duplicar após reinício.
      const recent = await channel.messages.fetch({ limit: 25 });
      panel = recent.find(m => m.author.id === client.user?.id && m.components.length > 0) ?? null;
    }
    if (panel) await panel.edit(payload as MessageEditOptions);
    else panel = await channel.send(payload as MessageCreateOptions);
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
