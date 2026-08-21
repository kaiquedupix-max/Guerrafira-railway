import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

function cleanJsonInput(raw: string): string {
  const value = raw.trim();
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : value;
}

function normalizePayload(input: unknown): any {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("O JSON precisa ser um objeto de mensagem do Discord.");
  }

  const source = input as Record<string, unknown>;
  const payload: any = {};

  if (typeof source.content === "string") payload.content = source.content;
  if (Array.isArray(source.embeds)) payload.embeds = source.embeds;
  if (Array.isArray(source.components)) payload.components = source.components;
  if (typeof source.tts === "boolean") payload.tts = source.tts;

  const allowed = (source.allowedMentions ?? source.allowed_mentions) as any;
  if (allowed && typeof allowed === "object" && !Array.isArray(allowed)) {
    payload.allowedMentions = {
      parse: Array.isArray(allowed.parse) ? allowed.parse : undefined,
      roles: Array.isArray(allowed.roles) ? allowed.roles : undefined,
      users: Array.isArray(allowed.users) ? allowed.users : undefined,
      repliedUser: typeof allowed.replied_user === "boolean"
        ? allowed.replied_user
        : typeof allowed.repliedUser === "boolean"
          ? allowed.repliedUser
          : undefined,
    };
  }

  if (!payload.content && !payload.embeds?.length && !payload.components?.length) {
    throw new Error("O JSON não possui content, embeds ou components para enviar.");
  }
  if (typeof payload.content === "string" && payload.content.length > 2000) {
    throw new Error("O campo content ultrapassa 2000 caracteres.");
  }
  if (payload.embeds?.length > 10) throw new Error("O Discord permite no máximo 10 embeds por mensagem.");
  if (payload.components?.length > 5) throw new Error("O Discord permite no máximo 5 linhas de componentes.");

  return payload;
}

export const data = new SlashCommandBuilder()
  .setName("enviarjson")
  .setDescription("Envia uma mensagem do Discord a partir de um JSON.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption(option => option
    .setName("canal")
    .setDescription("Canal onde a mensagem será enviada")
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setRequired(true))
  .addStringOption(option => option
    .setName("json")
    .setDescription("Cole o JSON da mensagem/embed")
    .setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const selected = interaction.options.getChannel("canal", true);
    const channel = await interaction.client.channels.fetch(selected.id).catch(() => null);
    if (!channel?.isSendable()) throw new Error("Esse canal não aceita mensagens do bot.");

    const raw = cleanJsonInput(interaction.options.getString("json", true));
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch (error) {
      const detail = error instanceof Error ? error.message : "JSON inválido";
      throw new Error(`JSON inválido: ${detail}`);
    }

    const payload = normalizePayload(parsed);
    const sent = await channel.send(payload);
    await interaction.editReply(`✅ JSON enviado em <#${selected.id}>.\nMensagem: ${sent.url}`);
  } catch (error) {
    await interaction.editReply(`❌ ${error instanceof Error ? error.message : "Falha ao enviar o JSON."}`);
  }
}
