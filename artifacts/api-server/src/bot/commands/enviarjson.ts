import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

const COMPONENTS_V2_FLAG = 1 << 15; // IS_COMPONENTS_V2 = 32768

function cleanJsonInput(raw: string): string {
  const value = raw.trim();
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function usesComponentsV2(components: unknown): boolean {
  if (!Array.isArray(components)) return false;

  // Legacy message components have Action Row (type 1) at the top level.
  // Components V2 can place Section/Text Display/Media Gallery/Container/etc.
  // directly at the top level (for example Container = type 17).
  return components.some(component => {
    if (!isObject(component)) return false;
    return typeof component.type === "number" && component.type !== 1;
  });
}

function normalizePayload(input: unknown): Record<string, unknown> {
  if (!isObject(input)) {
    throw new Error("O JSON precisa ser um objeto de mensagem do Discord.");
  }

  const source = input;
  const payload: Record<string, unknown> = {};
  const v2 = usesComponentsV2(source.components) ||
    (typeof source.flags === "number" && (source.flags & COMPONENTS_V2_FLAG) === COMPONENTS_V2_FLAG);

  if (typeof source.content === "string") payload.content = source.content;
  if (Array.isArray(source.embeds)) payload.embeds = source.embeds;
  if (Array.isArray(source.components)) payload.components = source.components;
  if (typeof source.tts === "boolean") payload.tts = source.tts;

  // Preserve flags from JSON. This was the main reason Components V2 failed:
  // flags: 32768 was previously discarded before the message was sent.
  if (typeof source.flags === "number" && Number.isInteger(source.flags)) {
    payload.flags = v2 ? (source.flags | COMPONENTS_V2_FLAG) : source.flags;
  } else if (v2) {
    payload.flags = COMPONENTS_V2_FLAG;
  }

  const allowed = (source.allowed_mentions ?? source.allowedMentions) as unknown;
  if (isObject(allowed)) {
    payload.allowed_mentions = {
      parse: Array.isArray(allowed.parse) ? allowed.parse : undefined,
      roles: Array.isArray(allowed.roles) ? allowed.roles : undefined,
      users: Array.isArray(allowed.users) ? allowed.users : undefined,
      replied_user: typeof allowed.replied_user === "boolean"
        ? allowed.replied_user
        : typeof allowed.repliedUser === "boolean"
          ? allowed.repliedUser
          : undefined,
    };
  }

  if (typeof source.nonce === "string" || typeof source.nonce === "number") payload.nonce = source.nonce;
  if (typeof source.enforce_nonce === "boolean") payload.enforce_nonce = source.enforce_nonce;

  const hasContent = typeof payload.content === "string" && payload.content.length > 0;
  const hasEmbeds = Array.isArray(payload.embeds) && payload.embeds.length > 0;
  const hasComponents = Array.isArray(payload.components) && payload.components.length > 0;

  if (!hasContent && !hasEmbeds && !hasComponents) {
    throw new Error("O JSON não possui content, embeds ou components para enviar.");
  }

  if (typeof payload.content === "string" && payload.content.length > 2000) {
    throw new Error("O campo content ultrapassa 2000 caracteres.");
  }

  if (Array.isArray(payload.embeds) && payload.embeds.length > 10) {
    throw new Error("O Discord permite no máximo 10 embeds por mensagem.");
  }

  // Components V2 replace the traditional content/embed layout.
  // Give a clear error instead of sending an invalid Discord request.
  if (v2 && (hasContent || hasEmbeds)) {
    throw new Error(
      "Components V2 não podem ser enviados junto com content/embeds. " +
      "Coloque o texto dentro de componentes type 10 (Text Display) e mantenha flags: 32768.",
    );
  }

  // Only legacy components are limited to 5 top-level Action Rows.
  if (!v2 && Array.isArray(payload.components) && payload.components.length > 5) {
    throw new Error("Componentes antigos permitem no máximo 5 Action Rows por mensagem.");
  }

  return payload;
}

function formatDiscordError(error: unknown): string {
  if (!isObject(error)) return error instanceof Error ? error.message : "Falha ao enviar o JSON.";

  const rawError = error.rawError;
  if (isObject(rawError)) {
    const message = typeof rawError.message === "string" ? rawError.message : "Erro da API do Discord";
    if (rawError.errors) {
      try {
        return `${message}\n\`${JSON.stringify(rawError.errors).slice(0, 1500)}\``;
      } catch {
        return message;
      }
    }
    return message;
  }

  return error instanceof Error ? error.message : "Falha ao enviar o JSON.";
}

export const data = new SlashCommandBuilder()
  .setName("enviarjson")
  .setDescription("Envia JSON do Discord, incluindo Components V2.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption(option => option
    .setName("canal")
    .setDescription("Canal onde a mensagem será enviada")
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setRequired(true))
  .addStringOption(option => option
    .setName("json")
    .setDescription("Cole o JSON da mensagem, embed ou Components V2")
    .setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const selected = interaction.options.getChannel("canal", true);
    const channel = await interaction.client.channels.fetch(selected.id).catch(() => null);
    if (!channel?.isSendable()) throw new Error("Esse canal não aceita mensagens do bot.");

    const raw = cleanJsonInput(interaction.options.getString("json", true));
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "JSON inválido";
      throw new Error(`JSON inválido: ${detail}`);
    }

    const payload = normalizePayload(parsed);

    // Send directly through Discord REST. channel.send() in older discord.js
    // validates components using the legacy union and rejects V2 types such as 17.
    const sent = await interaction.client.rest.post(
      Routes.channelMessages(selected.id),
      { body: payload },
    ) as { id: string };

    const guildId = interaction.guildId;
    const messageUrl = guildId
      ? `https://discord.com/channels/${guildId}/${selected.id}/${sent.id}`
      : `https://discord.com/channels/@me/${selected.id}/${sent.id}`;

    const isV2 = typeof payload.flags === "number" &&
      (payload.flags & COMPONENTS_V2_FLAG) === COMPONENTS_V2_FLAG;

    await interaction.editReply(
      `✅ JSON enviado em <#${selected.id}>${isV2 ? " com Components V2" : ""}.\nMensagem: ${messageUrl}`,
    );
  } catch (error) {
    await interaction.editReply(`❌ ${formatDiscordError(error)}`);
  }
}
