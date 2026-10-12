import {
  SlashCommandBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { searchPlayers } from "../utils/players.js";
import { getTeamMembers, type TeamMember } from "./duo.js";
import { ActionError, banPlayer, type BanDuration } from "../../core/systemActions.js";

const STEAM_ID_RE = /^7656119\d{10}$/;
const ANONYMOUS_MODERATOR_ROLE_ID = "1538735197611360347";
const ANONYMOUS_MODERATOR_LABEL = "Equipe de Moderação";

const STANDARD_BAN_REASONS = [
  { name: "Cheat / Trapaça", value: "cheat", label: "Cheat / Trapaça" },
  { name: "Violação de regra de duo", value: "duo_rule", label: "Violação de regra de duo" },
  { name: "Violação do limite de jogadores por time", value: "team_limit", label: "Violação do limite de jogadores por time" },
  { name: "Racismo", value: "racism", label: "Racismo" },
  { name: "Discurso de ódio", value: "hate_speech", label: "Discurso de ódio" },
  { name: "Assédio / Toxicidade grave", value: "harassment", label: "Assédio / Toxicidade grave" },
  { name: "Exploit / Abuso de bug", value: "exploit", label: "Exploit / Abuso de bug" },
  { name: "Evasão de banimento", value: "ban_evasion", label: "Evasão de banimento" },
  { name: "Stream sniping", value: "stream_sniping", label: "Stream sniping" },
  { name: "Griefing / Sabotagem", value: "griefing", label: "Griefing / Sabotagem" },
  { name: "Teaming / Cooperação proibida", value: "teaming", label: "Teaming / Cooperação proibida" },
  { name: "Recusa de verificação administrativa", value: "refused_verification", label: "Recusa de verificação administrativa" },
  { name: "Golpe / Fraude contra jogadores", value: "scam", label: "Golpe / Fraude contra jogadores" },
  { name: "Outro / Decisão administrativa", value: "other", label: "Outro / Decisão administrativa" },
] as const;

async function moderationActor(interaction: ChatInputCommandInteraction) {
  const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
  const anonymous = member?.roles.cache.has(ANONYMOUS_MODERATOR_ROLE_ID) ?? false;
  const displayName = member?.displayName?.trim() || interaction.user.globalName?.trim() || interaction.user.username?.trim() || "Administrador";
  return anonymous
    ? { id: interaction.user.id, name: ANONYMOUS_MODERATOR_LABEL, source: "system" as const }
    : { id: interaction.user.id, name: displayName, source: "discord" as const };
}

function buildBanReason(reasonKey: string, details: string): string {
  const selected = STANDARD_BAN_REASONS.find((reason) => reason.value === reasonKey);
  if (!selected) throw new ActionError("Motivo de banimento inválido.");

  if (reasonKey === "other" && !details) {
    throw new ActionError("Ao escolher 'Outro / Decisão administrativa', informe os detalhes do motivo.");
  }

  return details ? `${selected.label} — ${details}` : selected.label;
}

function uniqueTeamMembers(members: TeamMember[], mainSteamId: string): TeamMember[] {
  const unique = new Map<string, TeamMember>();
  for (const member of members) {
    if (member.steamId !== mainSteamId) unique.set(member.steamId, member);
  }
  return [...unique.values()];
}

export const data = new SlashCommandBuilder()
  .setName("banir")
  .setDescription("Bane um jogador do servidor (online ou offline)")
  .addStringOption(opt =>
    opt
      .setName("jogador")
      .setDescription("Pesquise pelo nome ou informe o SteamID64")
      .setRequired(false)
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption(opt =>
    opt
      .setName("duracao")
      .setDescription("Duração do banimento")
      .setRequired(false)
      .addChoices(
        { name: "3 Dias", value: "3d" },
        { name: "7 Dias", value: "7d" },
        { name: "Permanente", value: "perm" },
      )
  )
  .addStringOption(opt =>
    opt
      .setName("motivo")
      .setDescription("Motivo padronizado do banimento")
      .setRequired(false)
      .addChoices(...STANDARD_BAN_REASONS.map(({ name, value }) => ({ name, value })))
  )
  .addStringOption(opt =>
    opt
      .setName("banir_duo")
      .setDescription("Banir também o duo/time atual por associação?")
      .setRequired(false)
      .addChoices(
        { name: "Sim — banir por associação", value: "sim" },
        { name: "Não — banir somente este jogador", value: "nao" },
      )
  )
  .addStringOption(opt =>
    opt
      .setName("duracao_duo")
      .setDescription("Duração do banimento do duo/time por associação")
      .setRequired(false)
      .addChoices(
        { name: "3 Dias", value: "3d" },
        { name: "7 Dias", value: "7d" },
        { name: "Permanente", value: "perm" },
      )
  )
  .addStringOption(opt =>
    opt
      .setName("detalhes")
      .setDescription("Detalhes adicionais do motivo (obrigatório se escolher Outro)")
      .setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().trim();
  const players = await searchPlayers(focused, 25);
  const suggestions = players.map(p => ({
    name: `${p.isOnline ? "🟢 ONLINE" : "⚫ OFFLINE"} • ${p.playerName} — ${p.steamId}`.slice(0, 100),
    value: p.steamId,
  }));

  if (STEAM_ID_RE.test(focused) && !suggestions.some(s => s.value === focused)) {
    suggestions.unshift({
      name: `⚫ OFFLINE • Banir diretamente SteamID ${focused}`.slice(0, 100),
      value: focused,
    });
  }

  await interaction.respond(suggestions.slice(0, 25));
}

type BanSelection = { duration: BanDuration; reasonKey: string; shouldBanDuo: boolean; associationDuration: BanDuration };
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
    await interaction.editReply("❌ Sem permissão para banir jogadores."); return;
  }
  const selection: BanSelection = {
    duration: (interaction.options.getString("duracao") || "perm") as BanDuration,
    reasonKey: interaction.options.getString("motivo") || "cheat",
    shouldBanDuo: interaction.options.getString("banir_duo") !== "nao",
    associationDuration: (interaction.options.getString("duracao_duo") || interaction.options.getString("duracao") || "perm") as BanDuration,
  };
  const durations = [{ label: "3 dias", value: "3d" }, { label: "7 dias", value: "7d" }, { label: "Permanente", value: "perm" }];
  const menu = (id: string, label: string, options: { label: string; value: string }[], value: string) =>
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(label).addOptions(options.map(o => ({ ...o, default: o.value === value }))));
  const panel = () => ({ content: "Selecione as opções e confirme o banimento do jogador e do duo/time por associação.", components: [
    menu("ban_panel_reason", "Motivo", STANDARD_BAN_REASONS.map(r => ({ label: r.label, value: r.value })), selection.reasonKey),
    menu("ban_panel_duration", "Duração do jogador", durations, selection.duration),
    menu("ban_panel_team", "Duo/time", [{ label: "Banir duo/time por associação", value: "sim" }, { label: "Somente o jogador", value: "nao" }], selection.shouldBanDuo ? "sim" : "nao"),
    menu("ban_panel_team_duration", "Duração por associação", durations, selection.associationDuration),
    new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("ban_panel_confirm").setLabel("Confirmar banimento").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId("ban_panel_cancel").setLabel("Cancelar").setStyle(ButtonStyle.Secondary))
  ] });
  const message = await interaction.editReply(panel());
  const collector = message.createMessageComponentCollector({ time: 300000, filter: i => i.user.id === interaction.user.id && i.customId.startsWith("ban_panel_") });
  let finished = false;
  collector.on("collect", async i => {
    try {
      if (finished) { await i.deferUpdate(); return; }
      if (i.isStringSelectMenu()) {
        if (i.customId === "ban_panel_reason") selection.reasonKey = i.values[0];
        if (i.customId === "ban_panel_duration") selection.duration = i.values[0] as BanDuration;
        if (i.customId === "ban_panel_team_duration") selection.associationDuration = i.values[0] as BanDuration;
        if (i.customId === "ban_panel_team") selection.shouldBanDuo = i.values[0] === "sim";
        await i.update(panel()); return;
      }
      finished = true; collector.stop("finished");
      await i.update({ content: i.customId === "ban_panel_cancel" ? "Banimento cancelado." : "Aplicando banimentos…", components: [] });
      if (i.customId === "ban_panel_confirm") await applyBan(interaction, { ...selection });
    } catch {
      await interaction.editReply({ content: "❌ Falha no painel. Consulte os registros antes de tentar novamente.", components: [] }).catch(() => {});
    }
  });
  collector.on("end", () => { if (!finished) interaction.editReply({ content: "Painel expirado. Execute /banir novamente.", components: [] }).catch(() => {}); });
}
async function applyBan(interaction: ChatInputCommandInteraction, selection: BanSelection): Promise<void> {


  try {
    const steamId = interaction.options.getString("jogador", true).trim();
    const { duration, reasonKey, shouldBanDuo, associationDuration } = selection;
    const details = interaction.options.getString("detalhes")?.trim() ?? "";

    if (shouldBanDuo && !associationDuration) {
      throw new ActionError("Escolha a duração do banimento do duo/time por associação.");
    }

    const reason = buildBanReason(reasonKey, details);
    const actor = await moderationActor(interaction);

    let associatedMembers: TeamMember[] = [];
    let associationLookupFailed = false;

    if (shouldBanDuo) {
      try {
        associatedMembers = uniqueTeamMembers(await getTeamMembers(steamId), steamId);
      } catch {
        throw new ActionError("Não foi possível consultar o duo/time. Nenhum banimento foi iniciado.");
      }
    }

    const result = await banPlayer({
      steamId,
      duration,
      reason,
      actor,
    });

    const associatedBanned: string[] = [];
    const associatedFailed: string[] = [];

    for (const member of associatedMembers) {
      const associationReason =
        `Banido por associação a ${result.playerName} (${steamId}). Motivo original: ${reason}`;

      try {
        const associated = await banPlayer({
          steamId: member.steamId,
          duration: associationDuration,
          association: { steamId, playerName: result.playerName },
          reason: associationReason,
          actor,
          playerName: member.name && member.name !== "Desconhecido" ? member.name : undefined,
        });
        associatedBanned.push(`${associated.playerName} (${member.steamId})`);
      } catch (error) {
        const errorMessage = error instanceof ActionError ? error.message : "falha interna";
        associatedFailed.push(`${member.name || member.steamId}: ${errorMessage}`);
      }
    }

    const expiry = result.expiresAt
      ? `\n📅 Expira: <t:${Math.floor(result.expiresAt.getTime() / 1000)}:F>`
      : "\n📅 Banimento permanente";

    const associationStatus = !shouldBanDuo
      ? "\n👤 Duo/time **não banido por associação**."
      : associationLookupFailed
        ? "\n⚠️ Não foi possível consultar o duo/time. O jogador principal foi banido normalmente."
        : associatedMembers.length === 0
          ? "\n👤 Nenhum duo/time foi encontrado. Somente o jogador principal foi banido."
          : `\n👥 Banidos por associação: **${associatedBanned.length}** de **${associatedMembers.length}** • duração: **${associationDuration?.toUpperCase()}**.` +
            (associatedBanned.length ? `\n• ${associatedBanned.join("\n• ")}` : "") +
            (associatedFailed.length ? `\n⚠️ Falhas: ${associatedFailed.join(" | ")}` : "");

    await interaction.editReply(
      `✅ **${result.playerName}** foi banido com confirmação do servidor.${expiry}\n📝 Motivo: **${reason}**${associationStatus}`
    );
  } catch (error) {
    await interaction.editReply(
      `❌ ${error instanceof ActionError ? error.message : "Falha interna ao aplicar o banimento."}`
    );
  }
}
