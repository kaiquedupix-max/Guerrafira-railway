import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  UserSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder,
  MessageFlags, PermissionsBitField, type ChatInputCommandInteraction,
  type AutocompleteInteraction, type MessageEditOptions,
  type MessageComponentInteraction, type ModalSubmitInteraction,
} from "discord.js";
import { randomUUID } from "node:crypto";
import { logger } from "../../lib/logger.js";

type Option = { name: string; description: string; type: number; required?: boolean; autocomplete?: boolean;
  choices?: { name: string; value: string | number }[]; options?: Option[];
  min_value?: number; max_value?: number; min_length?: number; max_length?: number; channel_types?: number[] };
type Definition = Option & { default_member_permissions?: string | null };
type Command = { data: { name: string; toJSON(): unknown }; execute(i: ChatInputCommandInteraction): Promise<void>; autocomplete?(i: AutocompleteInteraction): Promise<void> };
type Entry = { command: Command; definition: Definition; path: string[]; fields: Option[]; label: string };
let commands: Command[] = [];
const activeMenus = new Set<string>();
const modalButtons = new Map<string, (i: MessageComponentInteraction) => Promise<void>>();
export async function handleMenuInteraction(interaction: MessageComponentInteraction | ModalSubmitInteraction): Promise<void> {
  const session = interaction.customId.split(":").slice(0, 2).join(":") + ":";
  if (!activeMenus.has(session)) {
    await interaction.reply({ content: "Este painel expirou ou o bot foi reiniciado. Abra /menu novamente para pesquisar jogadores.", flags: MessageFlags.Ephemeral });
  } else if (interaction.isMessageComponent()) {
    await modalButtons.get(session)?.(interaction);
  }
}
export const data = new SlashCommandBuilder().setName("menu").setDescription("Abre o painel com todas as funções do bot")
  .addAttachmentOption(o => o.setName("arquivo").setDescription("Arquivo opcional para usar nas funções que aceitam anexos"));
export function configureMenu(available: Command[]) { commands = available.filter(c => c.data.name !== "menu"); }
export function menuEntries(available: Command[] = commands): Entry[] {
  const entries: Entry[] = [];
  for (const command of available) {
    const definition = command.data.toJSON() as Definition;
    const walk = (node: Option, path: string[]) => {
      const children = (node.options ?? []).filter(o => o.type === 1 || o.type === 2);
      if (children.length) for (const child of children) walk(child, [...path, child.name]);
      else entries.push({ command, definition, path, fields: definition.name === "banir" ? (node.options ?? []).filter(o => o.name === "jogador" || o.name === "servidor") : node.options ?? [], label: [definition.name, ...path].join(" ") });
    };
    walk(definition, []);
  }
  return entries;
}
export function canUse(definition: Definition, permissions: Readonly<PermissionsBitField> | null): boolean {
  return definition.default_member_permissions == null || Boolean(permissions?.has(new PermissionsBitField(BigInt(definition.default_member_permissions) || PermissionsBitField.Flags.Administrator)));
}
export function validateValue(field: Option, raw: string): string | number {
  const value = raw.trim();
  if (!value) throw new Error("Preencha o campo ou use Pular quando ele for opcional.");
  if (field.type === 4 || field.type === 10) {
    const n = Number(value);
    if (!Number.isFinite(n) || (field.type === 4 && !Number.isSafeInteger(n))) throw new Error("Informe um número válido.");
    if (field.min_value !== undefined && n < field.min_value) throw new Error(`Valor mínimo: ${field.min_value}.`);
    if (field.max_value !== undefined && n > field.max_value) throw new Error(`Valor máximo: ${field.max_value}.`);
    return n;
  }
  if (field.min_length !== undefined && value.length < field.min_length) throw new Error(`Use pelo menos ${field.min_length} caracteres.`);
  if (field.max_length !== undefined && value.length > field.max_length) throw new Error(`Use no máximo ${field.max_length} caracteres.`);
  return value;
}
export function panelOptions(values: Map<string, unknown>, path: string[]) {
  const get = (name: string, required = false) => {
    const value = values.get(name) ?? null;
    if (value === null && required) throw new Error(`Preencha ${name}.`);
    return value;
  };
  return { getString: get, getInteger: get, getNumber: get, getBoolean: get,
    getUser: get, getChannel: get, getRole: get, getAttachment: get,
    getSubcommand: () => path.at(-1) ?? null, getSubcommandGroup: () => path.length > 1 ? path[0] : null };
}
const row = (...buttons: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
const button = (id: string, label: string, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!interaction.inGuild()) { await interaction.editReply("Abra o menu dentro do servidor Discord."); return; }
  const session = `menu:${randomUUID()}:`;
  activeMenus.add(session);
  const id = (key: string) => session + key;
  const message = await interaction.editReply({ content: "Abrindo painel…", components: [] });
  const wait = () => message.awaitMessageComponent({ time: 300_000, filter: i => i.user.id === interaction.user.id && i.customId.startsWith(session) });
  const cancel = button(id("cancel"), "Fechar");
  try {
    let page = 0;
    while (true) {
      const member = await interaction.guild!.members.fetch({ user: interaction.user.id, force: true });
      const entries = menuEntries().filter(e => canUse(e.definition, member.permissions));
      if (!entries.length) { await interaction.editReply({ content: "Nenhuma função disponível para seus cargos.", components: [] }); return; }
      const pages = Math.ceil(entries.length / 25);
      page = Math.max(0, Math.min(page, pages - 1));
      const select = new StringSelectMenuBuilder().setCustomId(id("command")).setPlaceholder("Escolha o que você quer fazer").addOptions(
        entries.slice(page * 25, (page + 1) * 25).map((e, offset) => ({ label: ({banir:"Banir jogador • Steam + IP",desbanir:"Desbanir jogador • Steam + IP",banpreventivo:"Bloquear até verificação",kickar:"Expulsar do servidor",mute:"Silenciar jogador",unmute:"Remover silêncio",duo:"Consultar time",listaplayer:"Pesquisar jogadores"}[e.definition.name]||e.label).slice(0, 100), description: (e.path.length ? e.fields.length ? "Selecione e preencha as opções" : "Selecione para abrir" : e.definition.description).slice(0, 100), value: String(page * 25 + offset) })));
      await interaction.editReply({ content: `**Guerra Fria • Menu do bot**\nEscolha uma função. Página ${page + 1}/${pages}.\nAs funções disponíveis seguem as permissões dos seus cargos.`, embeds: [], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), row(button(id("prev"), "Anterior").setDisabled(page === 0), button(id("next"), "Próxima").setDisabled(page === pages - 1), cancel)] });
      const chosen = await wait();
      if (chosen.customId === id("cancel")) { await chosen.update({ content: "Menu fechado.", components: [] }); return; }
      if (chosen.customId === id("prev") || chosen.customId === id("next")) { page += chosen.customId === id("next") ? 1 : -1; await chosen.deferUpdate(); continue; }
      if (!chosen.isStringSelectMenu()) { await chosen.deferUpdate(); continue; }
      const entry = entries[Number(chosen.values[0])];
      if (!entry) { await chosen.deferUpdate(); continue; }
      await chosen.deferUpdate();
      const values = new Map<string, unknown>();
      const suggestionsFor = async (field: Option, query: string) => {
        let suggestions: { name: string; value: string | number }[] = [];
        if (!entry.command.autocomplete) return suggestions;
        const context = new Proxy(interaction, { get(target, key) {
          if (key === "options") return { ...panelOptions(values, entry.path), getFocused: () => query };
          if (key === "respond") return async (found: typeof suggestions) => { suggestions = found.filter(s => s.value !== "none").slice(0, 25); };
          if (key === "responded") return false;
          const v = Reflect.get(target, key, target); return typeof v === "function" ? v.bind(target) : v;
        } }) as unknown as AutocompleteInteraction;
        await entry.command.autocomplete(context);
        return suggestions;
      };
      let back = false;
      const fields = [...entry.fields].sort((a, b) => Number(b.name === "servidor") - Number(a.name === "servidor"));
      for (const field of fields) {
        let complete = false, error = "";
        const searchable = Boolean(field.autocomplete && entry.command.autocomplete);
        let initialSuggestions: { name: string; value: string | number }[] = [];
        if (searchable) {
          try {
            initialSuggestions = await suggestionsFor(field, "");
            if (field.name === "jogador" && entry.definition.name !== "desbanir") {
              initialSuggestions = initialSuggestions.filter(s => s.name.includes("🟢"));
            }
          } catch (err) { logger.error({ err }, "Initial menu player list failed"); }
        }
        while (!complete) {
          const controls = row(button(id("back"), "Voltar ao menu"), cancel);
          if (!field.required) controls.addComponents(button(id("skip"), "Pular"));
          const components: NonNullable<MessageEditOptions["components"]>[number][] = [];
          if (searchable) {
            if (initialSuggestions.length) components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(id("value")).setPlaceholder(entry.definition.name === "desbanir" ? "Selecione um jogador banido" : "Selecione um jogador ou pesquise pelo nome").addOptions(initialSuggestions.map(s => ({ label: s.name.slice(0, 100), value: String(s.value) })))));
            controls.addComponents(button(id("fill"), "Pesquisar por nome", ButtonStyle.Primary));
          } else if (field.choices?.length || field.type === 5) {
            const choices = field.choices ?? [{ name: "Sim", value: "true" }, { name: "Não", value: "false" }];
            components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(id("value")).setPlaceholder(field.name).addOptions(choices.map(c => ({ label: c.name.slice(0, 100), value: String(c.value) })))));
          } else if (field.type === 6) {
            components.push(new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(id("value")).setPlaceholder("Selecione um membro")));
          } else if (field.type === 7) {
            const select = new ChannelSelectMenuBuilder().setCustomId(id("value")).setPlaceholder("Selecione um canal");
            if (field.channel_types?.length) select.setChannelTypes(field.channel_types);
            components.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select));
          } else if (field.type === 8) {
            components.push(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(id("value")).setPlaceholder("Selecione um cargo")));
          } else if (field.type === 11) {
            const attachment = interaction.options.getAttachment("arquivo");
            if (attachment) controls.addComponents(button(id("attachment"), "Usar arquivo anexado", ButtonStyle.Primary));
          } else controls.addComponents(button(id("fill"), "Preencher", ButtonStyle.Primary));
          components.push(controls);
          await interaction.editReply({ content: `**${entry.label} • ${field.name}**\n${searchable ? "Selecione na lista ou clique em Pesquisar por nome, digite parte do nick e escolha o resultado." : field.description}\n${field.required ? "Obrigatório" : "Opcional"}${searchable && !initialSuggestions.length ? " • Nenhum jogador disponível na lista inicial. Use a pesquisa." : ""}${field.type === 11 ? " • Anexe o arquivo ao executar /menu para selecioná-lo aqui." : ""}${error ? `\n❌ ${error}` : ""}`, components });
          const input = await wait();
          if (input.customId === id("cancel")) { await input.update({ content: "Menu fechado. Nenhuma ação executada.", components: [] }); return; }
          if (input.customId === id("back")) { await input.deferUpdate(); back = true; break; }
          if (input.customId === id("skip") && !field.required) { await input.deferUpdate(); break; }
          if (input.customId === id("attachment")) { values.set(field.name, interaction.options.getAttachment("arquivo")); await input.deferUpdate(); complete = true; }
          else if (input.customId === id("fill")) {
            const modalId = id(randomUUID());
            const modal = new ModalBuilder().setCustomId(modalId).setTitle(searchable ? "Pesquisar jogador" : field.name.slice(0, 45)).addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("value").setLabel(searchable ? "Nome do jogador ou SteamID64" : field.description.slice(0, 45)).setStyle(field.name === "json" || field.name === "motivo" ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(true).setMaxLength(Math.min(field.max_length ?? 4000, 4000))));
            let dismiss!: (i: MessageComponentInteraction) => void;
            const dismissed = new Promise<MessageComponentInteraction>(resolve => { dismiss = resolve; });
            modalButtons.set(session, async i => {
              if (i.user.id !== interaction.user.id) { await i.reply({ content: "Abra seu próprio painel com /menu.", flags: MessageFlags.Ephemeral }); return; }
              if (i.customId === id("fill")) await i.showModal(modal);
              else dismiss(i);
            });
            try {
              await input.showModal(modal);
            } catch (err) {
              logger.error({ err }, "Menu modal could not open");
              if (!input.replied && !input.deferred) await input.reply({ content: "Não foi possível abrir a pesquisa. Abra /menu novamente.", flags: MessageFlags.Ephemeral }).catch(() => {});
              throw err;
            }
            const submitted = await Promise.race([input.awaitModalSubmit({ time: 300_000, filter: m => m.customId === modalId && m.user.id === interaction.user.id }), dismissed]);
            modalButtons.delete(session);
            if (!("fields" in submitted)) {
              if (submitted.customId === id("cancel")) { await submitted.update({ content: "Menu fechado. Nenhuma ação executada.", components: [] }); return; }
              await submitted.deferUpdate();
              if (submitted.customId === id("back")) back = true;
              if (submitted.customId === id("value") && submitted.isStringSelectMenu()) { values.set(field.name, submitted.values[0]); complete = true; break; }
              if (back || (submitted.customId === id("skip") && !field.required)) break;
              continue;
            }
            await submitted.deferUpdate();
            try {
              const value = validateValue(field, submitted.fields.getTextInputValue("value"));
              if (field.autocomplete && entry.command.autocomplete) {
                const suggestions = await suggestionsFor(field, String(value));
                if (!suggestions.length) { error = "Nenhum resultado encontrado. Tente o SteamID64 ou outro nome."; continue; }
                await interaction.editReply({ content: `**${entry.label} • ${field.name}**\nSelecione o resultado da busca.`, components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(id("result")).setPlaceholder("Selecione o resultado").addOptions(suggestions.map(s => ({ label: s.name.slice(0, 100), value: String(s.value) })))), row(button(id("retry"), "Buscar novamente"), button(id("back"), "Voltar ao menu"), cancel)] });
                const result = await wait();
                if (result.customId === id("cancel")) { await result.update({ content: "Menu fechado. Nenhuma ação executada.", components: [] }); return; }
                if (result.customId === id("back")) { await result.deferUpdate(); back = true; break; }
                if (!result.isStringSelectMenu()) { await result.deferUpdate(); continue; }
                values.set(field.name, result.values[0]); await result.deferUpdate();
              } else values.set(field.name, value);
              complete = true;
            } catch (err) { error = err instanceof Error ? err.message : "Valor inválido."; }
          } else {
            if (input.isStringSelectMenu()) {
              const selected = input.values[0];
              values.set(field.name, field.type === 5 ? selected === "true" : field.type === 4 || field.type === 10 ? Number(selected) : selected);
            } else if (input.isUserSelectMenu()) values.set(field.name, input.users.first());
            else if (input.isChannelSelectMenu()) values.set(field.name, input.channels.first());
            else if (input.isRoleSelectMenu()) values.set(field.name, input.roles.first());
            await input.deferUpdate(); complete = values.has(field.name);
          }
        }
        if (back) break;
      }
      if (back) continue;
      const summary = [...values].map(([key, value]) => `${key}: ${typeof value === "object" && value ? (value as { id?: string; name?: string }).name ?? (value as { id?: string }).id ?? "Arquivo" : String(value)}`).join("\n").slice(0, 1500);
      await interaction.editReply({ content: `**Confirmar: ${entry.label}**\n${summary || "Abrir função selecionada"}`, components: [row(button(id("execute"), "Confirmar", ButtonStyle.Primary), button(id("back"), "Voltar ao menu"), cancel)], allowedMentions: { parse: [] } });
      const confirmed = await wait();
      if (confirmed.customId === id("back")) { await confirmed.deferUpdate(); continue; }
      if (confirmed.customId !== id("execute")) { await confirmed.update({ content: "Menu fechado. Nenhuma ação executada.", components: [] }); return; }
      await confirmed.deferUpdate();
      const current = await interaction.guild!.members.fetch({ user: interaction.user.id, force: true });
      if (!canUse(entry.definition, current.permissions)) { await confirmed.editReply({ content: "Você não tem mais permissão para esta função.", components: [] }); return; }
      await confirmed.editReply({ content: `Abrindo **${entry.label}**…`, components: [] });
      const context = new Proxy(confirmed, { get(target, key) {
        if (key === "options") return panelOptions(values, entry.path);
        if (key === "commandName") return entry.definition.name;
        if (key === "memberPermissions") return current.permissions;
        // Commands reuse the acknowledged component's response and selected options.
        if (key === "replied" || key === "deferred") return target[key];
        if (key === "deferReply") return async () => {};
        if (key === "reply") return target.editReply.bind(target);
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } }) as unknown as ChatInputCommandInteraction;
      await entry.command.execute(context);
      return;
    }
  } catch (error) {
    logger.error({ error, userId: interaction.user.id }, "Bot menu interaction ended");
    await interaction.editReply({ content: "O painel expirou ou encontrou uma falha. Abra /menu novamente. Se você confirmou uma ação, consulte os registros antes de repetir.", components: [] }).catch(() => {});
  } finally {
    activeMenus.delete(session);
    modalButtons.delete(session);
  }
}
