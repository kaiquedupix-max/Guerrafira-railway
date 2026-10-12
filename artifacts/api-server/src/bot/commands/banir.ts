import {
  SlashCommandBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
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
      .setRequired(true)
      .setAutocomplete(true)
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

type BanSelection = { duration: BanDuration; reasonKey: string; shouldBanDuo: boolean; associationDuration: BanDuration; teamCount?: number; teamMembers?: TeamMember[]; details?: string };
export async function resolveTeamRoster(mainSteamId: string, countText: string, membersText: string): Promise<TeamMember[]> {
  const count = Number(countText.trim());
  if (!Number.isSafeInteger(count) || count < 2) throw new ActionError("Informe a quantidade total de membros, incluindo o jogador principal (mínimo 2).");
  const roster = new Map<string, TeamMember>([[mainSteamId, { steamId: mainSteamId, name: mainSteamId }]]);
  for (const input of membersText.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
    if (STEAM_ID_RE.test(input)) { roster.set(input, { steamId: input, name: input }); continue; }
    const matches = await searchPlayers(input, 25);
    const exact = matches.filter(p => p.playerName.toLowerCase() === input.toLowerCase());
    const candidates = exact.length ? exact : matches;
    if (candidates.length !== 1) throw new ActionError(`Jogador "${input}" ${candidates.length ? "ambíguo; informe o SteamID64" : "não encontrado"}.`);
    const player = candidates[0];
    roster.set(player.steamId, { steamId: player.steamId, name: player.playerName });
  }
  if (roster.size !== count) throw new ActionError(`Você informou ${count} membros, mas selecionou ${roster.size} jogadores únicos, incluindo o principal. Confira a lista.`);
  return [...roster.values()];
}
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
  let detectedMembers: TeamMember[] = [];
  let choosingMembers = false;
  let candidates: TeamMember[] = [];
  const menu = (id: string, label: string, options: { label: string; value: string }[], value: string) =>
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(label).addOptions(options.map(o => ({ ...o, default: o.value === value }))));
  const panel = () => choosingMembers ? {
    content: "**Selecione os outros jogadores que serão banidos**\nO jogador principal já está incluído. Informe a quantidade total e marque os demais membros. Para pesquisar por nome ou incluir mais jogadores, use Informar nomes.\nSelecionados: " + (selection.teamMembers?.map(m => m.name).join(", ") || "somente o principal"),
    components: [
      menu("ban_panel_count", "Quantos membros no total, incluindo o principal?", Array.from({length: 24}, (_, n) => ({label: String(n + 2) + " membros", value: String(n + 2)})), String(selection.teamCount || "")),
      ...(candidates.length ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("ban_panel_members").setPlaceholder("Marque os outros jogadores").setMinValues(0).setMaxValues(candidates.length).addOptions(candidates.map(m => ({label: (m.name + " — " + m.steamId).slice(0,100), value: m.steamId, default: selection.teamMembers?.some(x => x.steamId === m.steamId) || false}))))] : []),
      new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("ban_panel_roster").setLabel("Informar nomes / SteamIDs").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId("ban_panel_back").setLabel("Revisar banimento").setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId("ban_panel_cancel").setLabel("Cancelar").setStyle(ButtonStyle.Secondary))
    ]
  } : ({ content: selection.reasonKey === "team_limit"
    ? `**Violação do limite de time**\nClique em Configurar membros e informe quantos jogadores há no time, incluindo o principal. Todos receberão o motivo de violação de limite de time e uma notificação individual no chat.\n${selection.teamMembers ? `**${selection.teamCount} jogadores confirmados:**\n${selection.teamMembers.map(m => `• ${m.name} (${m.steamId})`).join("\n").slice(0, 1200)}` : "Nenhum time confirmado ainda."}`
    : `**Motivo: ${STANDARD_BAN_REASONS.find(r => r.value === selection.reasonKey)?.label}**\nDuração: ${selection.duration.toUpperCase()}\n${selection.teamMembers ? "Jogadores: " + selection.teamMembers.map(m => m.name).join(", ") : "Escolha o motivo abaixo e selecione os outros jogadores, se houver."}`, components: [
    menu("ban_panel_reason", "Motivo", STANDARD_BAN_REASONS.map(r => ({ label: r.label, value: r.value })), selection.reasonKey),
    menu("ban_panel_duration", "Duração do jogador", durations, selection.duration),
    ...(selection.reasonKey === "team_limit" ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("ban_panel_roster").setLabel("Configurar membros do time").setStyle(ButtonStyle.Primary))] : [
      menu("ban_panel_team", "Duo/time", [{ label: "Banir duo/time por associação", value: "sim" }, { label: "Somente o jogador", value: "nao" }], selection.shouldBanDuo ? "sim" : "nao"),
      menu("ban_panel_team_duration", "Duração por associação", durations, selection.associationDuration),
    ]),
    new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("ban_panel_choose").setLabel("Escolher jogadores").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId("ban_panel_details").setLabel("Detalhes do motivo").setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId("ban_panel_confirm").setLabel("Confirmar banimento").setStyle(ButtonStyle.Danger).setDisabled((selection.reasonKey === "team_limit" || selection.shouldBanDuo) && !selection.teamMembers), new ButtonBuilder().setCustomId("ban_panel_cancel").setLabel("Cancelar").setStyle(ButtonStyle.Secondary))
  ] });
  const message = await interaction.editReply(panel());
  const collector = message.createMessageComponentCollector({ time: 300000, filter: i => i.user.id === interaction.user.id && i.customId.startsWith("ban_panel_") });
  let finished = false;
  collector.on("collect", async i => {
    try {
      if (finished) { await i.deferUpdate(); return; }
      if (i.customId === "ban_panel_choose") {
        await i.deferUpdate();
        const main = interaction.options.getString("jogador", true);
        const players = await searchPlayers("", 25);
        detectedMembers = uniqueTeamMembers(await getTeamMembers(main).catch(() => []), main);
        candidates = uniqueTeamMembers([...detectedMembers, ...players.map(p => ({steamId:p.steamId,name:p.playerName}))], main).slice(0,25);
        choosingMembers = true;
        if (!finished) await interaction.editReply(panel()); return;
      }
      if (i.customId === "ban_panel_back") { choosingMembers = false; await i.update(panel()); return; }
      if (i.customId === "ban_panel_details") {
        const modalId = "ban_details_" + i.id;
        await i.showModal(new ModalBuilder().setCustomId(modalId).setTitle("Detalhes do motivo").addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("details").setLabel("Detalhes adicionais (obrigatório para Outro)").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(250))));
        const submitted = await i.awaitModalSubmit({time:300000,filter:m=>m.customId===modalId&&m.user.id===interaction.user.id}).catch(()=>null);
        if (submitted) {await submitted.deferUpdate(); if (!finished) { selection.details=submitted.fields.getTextInputValue("details").trim(); await interaction.editReply(panel()); }} return;
      }
      if (i.customId === "ban_panel_roster") {
        const modalId = `ban_roster_${i.id}`;
        await i.showModal(new ModalBuilder().setCustomId(modalId).setTitle("Banir time por limite de membros").addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("count").setLabel("Quantos membros? Inclua o jogador principal").setStyle(TextInputStyle.Short).setRequired(true).setValue(selection.teamCount ? String(selection.teamCount) : String(detectedMembers.length + 1))),
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("members").setLabel("Demais membros: nome ou SteamID64 por linha").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000).setValue((selection.teamMembers?.filter(m => m.steamId !== interaction.options.getString("jogador", true)) ?? detectedMembers).map(m => m.steamId).join("\n").slice(0, 4000)))
        ));
        const submitted = await i.awaitModalSubmit({ time: 300_000, filter: m => m.customId === modalId && m.user.id === interaction.user.id }).catch(() => null);
        if (!submitted) return;
        await submitted.deferUpdate();
        if (finished) return;
        try {
          const roster = await resolveTeamRoster(interaction.options.getString("jogador", true).trim(), submitted.fields.getTextInputValue("count"), submitted.fields.getTextInputValue("members"));
          if (finished) return;
          selection.teamMembers = roster; selection.teamCount = roster.length;
          await interaction.editReply(panel());
        } catch (error) { await submitted.followUp({ content: `❌ ${error instanceof ActionError ? error.message : "Falha ao pesquisar os membros."}`, flags: MessageFlags.Ephemeral }); }
        return;
      }
      if (i.isStringSelectMenu()) {
        if (i.customId === "ban_panel_count") selection.teamCount = Number(i.values[0]);
        if (i.customId === "ban_panel_members") {
          const main = interaction.options.getString("jogador", true);
          selection.teamMembers = [{steamId:main,name:main}, ...candidates.filter(m => i.values.includes(m.steamId))];
        }
        if (i.customId === "ban_panel_reason") selection.reasonKey = i.values[0];
        if (i.customId === "ban_panel_duration") selection.duration = i.values[0] as BanDuration;
        if (i.customId === "ban_panel_team_duration") selection.associationDuration = i.values[0] as BanDuration;
        if (i.customId === "ban_panel_team") selection.shouldBanDuo = i.values[0] === "sim";
        await i.deferUpdate();
        if (i.customId === "ban_panel_reason" && selection.reasonKey === "team_limit") detectedMembers = uniqueTeamMembers(await getTeamMembers(interaction.options.getString("jogador", true)).catch(() => []), interaction.options.getString("jogador", true));
        if (!finished) await interaction.editReply(panel()); return;
      }
      if (i.customId === "ban_panel_confirm" && selection.reasonKey === "team_limit" && !selection.teamMembers) { await i.reply({ content: "Configure a quantidade e os membros antes de confirmar.", flags: MessageFlags.Ephemeral }); return; }
      if (i.customId === "ban_panel_confirm" && (selection.reasonKey === "team_limit" || selection.shouldBanDuo) && (!selection.teamMembers || selection.teamMembers.length !== selection.teamCount)) { await i.reply({content:"Escolha os jogadores e informe a quantidade total correspondente antes de confirmar.",flags:MessageFlags.Ephemeral}); return; }
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
    const details = selection.details ?? interaction.options.getString("detalhes")?.trim() ?? "";

    if (shouldBanDuo && !associationDuration) {
      throw new ActionError("Escolha a duração do banimento do duo/time por associação.");
    }

    const reason = buildBanReason(reasonKey, details);
    const actor = await moderationActor(interaction);
    if (reasonKey === "team_limit") {
      const roster = selection.teamMembers;
      if (!roster || roster.length !== selection.teamCount || !roster.some(m => m.steamId === steamId)) throw new ActionError("Confirme a quantidade e todos os membros do time antes de banir.");
      const succeeded: string[] = [], failed: string[] = [], noticesFailed: string[] = [];
      for (const member of roster) {
        try {
          const result = await banPlayer({ steamId: member.steamId, duration, reason, actor, playerName: member.name !== member.steamId ? member.name : undefined });
          succeeded.push(`${result.playerName} (${member.steamId})`);
          if (!result.gameNotified) noticesFailed.push(result.playerName);
        } catch (error) { failed.push(`${member.name}: ${error instanceof ActionError ? error.message : "Falha interna"}`); }
      }
      await interaction.editReply(`**Banimentos por violação do limite de time: ${succeeded.length}/${roster.length}**\nDuração: ${duration.toUpperCase()}\n${succeeded.map(s => `✅ ${s}`).join("\n")}\n${failed.map(s => `❌ ${s}`).join("\n")}${noticesFailed.length ? `\n⚠️ Banidos, mas sem confirmação da notificação no chat: ${noticesFailed.join(", ")}` : ""}`.slice(0, 2000));
      return;
    }

    let associatedMembers: TeamMember[] = [];
    let associationLookupFailed = false;

    if (shouldBanDuo) {
      try {
        associatedMembers = uniqueTeamMembers(selection.teamMembers ?? await getTeamMembers(steamId), steamId);
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
