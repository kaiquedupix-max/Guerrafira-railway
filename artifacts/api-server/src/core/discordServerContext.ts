import { SlashCommandBuilder, type ChatInputCommandInteraction, type AutocompleteInteraction } from "discord.js";
import { withAdminServer } from "./adminServerContext.js";
import { parseServerId } from "./servers.js";

export const serverCommands = new Set(["banir", "banpreventivo", "desbanir", "kickar", "mute", "unmute", "listaplayer", "duo"]);

export function addServerOption(data: { toJSON(): unknown }): void {
  (data as SlashCommandBuilder).addStringOption(option => option.setName("servidor")
    .setDescription("Servidor em que a ação será executada (padrão Solo/Duo)")
    .addChoices({ name: "Solo/Duo", value: "solo-duo" }, { name: "Trio", value: "trio" }));
}

export function runForCommandServer<T>(interaction: Pick<ChatInputCommandInteraction | AutocompleteInteraction, "options">, run: () => T): T {
  const selected = interaction.options.getString("servidor") || "solo-duo";
  const server = parseServerId(selected);
  if (!server) throw new Error("Servidor inválido.");
  return withAdminServer(server, run);
}
