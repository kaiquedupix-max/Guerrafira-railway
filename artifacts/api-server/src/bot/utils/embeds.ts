import { EmbedBuilder, type User } from "discord.js";
import type { ServerInfo } from "./rcon.js";

export { ServerInfo };

const COLOR_BAN     = 0xe74c3c;
const COLOR_KICK    = 0xe67e22;
const COLOR_VERIFY  = 0x2ecc71;
const COLOR_UNBAN   = 0x3498db;
const COLOR_STATUS_ONLINE  = 0x2ecc71;
const COLOR_STATUS_OFFLINE = 0xe74c3c;
const COLOR_KILL    = 0xe74c3c;
const COLOR_SUICIDE = 0x95a5a6;

const APPEAL_LINK = "discord.gg/guerrafria";

function ptBR(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function timeOnly(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function durationLabel(duration: string): string {
  switch (duration) {
    case "3d":   return "3 Dias";
    case "7d":   return "7 Dias";
    case "30d":  return "30 Dias";
    case "perm": return "Permanente";
    default:     return duration;
  }
}

function formatExpiry(expiresAt: Date | null): string {
  if (!expiresAt) return "🔴 Permanente";
  return ptBR(expiresAt);
}

// ─── Status ───────────────────────────────────────────────────────────────────
export function buildStatusEmbed(info: ServerInfo | null): EmbedBuilder {
  const updatedAt = timeOnly(new Date());

  if (!info) {
    return new EmbedBuilder()
      .setColor(COLOR_STATUS_OFFLINE)
      .setTitle("🔴  Servidor Offline")
      .setDescription("O servidor está inacessível ou o RCON não está respondendo.")
      .addFields({ name: "🔄 Última verificação", value: updatedAt })
      .setFooter({ text: "Guerra Fria • Status automático" })
      .setTimestamp();
  }

  return new EmbedBuilder()
    .setColor(COLOR_STATUS_ONLINE)
    .setTitle(`🟢  ${info.hostname}`)
    .setDescription("Servidor **online** e operacional.")
    .addFields(
      {
        name: "👥 Jogadores Online",
        value: `**${info.players}** / ${info.maxPlayers}`,
        inline: true,
      },
      {
        name: "😴 Dormindo",
        value: `**${info.sleepers}**`,
        inline: true,
      },
      {
        name: "\u200B",
        value: "\u200B",
        inline: true,
      },
      {
        name: "⏳ Na Fila",
        value: info.queued > 0 ? `**${info.queued}**` : "—",
        inline: true,
      },
      {
        name: "🔄 Conectando",
        value: info.joining > 0 ? `**${info.joining}**` : "—",
        inline: true,
      },
      {
        name: "🗺️ Mapa",
        value: info.map,
        inline: true,
      },
      {
        name: "🕐 Hora no Servidor",
        value: info.gameTime,
        inline: true,
      },
      {
        name: "🔁 Atualizado às",
        value: updatedAt,
        inline: true,
      }
    )
    .setFooter({ text: "Guerra Fria • Atualizado automaticamente a cada 60s" })
    .setTimestamp();
}

// ─── Kill feed ────────────────────────────────────────────────────────────────
export interface KillInfo {
  killer: string;
  victim: string;
  weapon?: string;
  distance?: string;
  isSuicide: boolean;
}

export function buildKillEmbed(kill: KillInfo): EmbedBuilder {
  if (kill.isSuicide) {
    return new EmbedBuilder()
      .setColor(COLOR_SUICIDE)
      .setTitle("💀  Morte")
      .addFields(
        { name: "👤 Jogador", value: kill.victim, inline: true },
        { name: "☠️ Causa", value: kill.weapon ?? "Suicídio / Ambiente", inline: true },
      )
      .setFooter({ text: "Guerra Fria • Kill Feed" })
      .setTimestamp();
  }

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "⚔️ Matador", value: `**${kill.killer}**`, inline: true },
    { name: "💀 Vítima",  value: `**${kill.victim}**`,  inline: true },
  ];
  if (kill.weapon)   fields.push({ name: "🔫 Arma",      value: kill.weapon,   inline: true });
  if (kill.distance) fields.push({ name: "📏 Distância", value: `${kill.distance}m`, inline: true });

  return new EmbedBuilder()
    .setColor(COLOR_KILL)
    .setTitle(`⚔️  ${kill.killer}  →  ${kill.victim}`)
    .addFields(...fields)
    .setFooter({ text: "Guerra Fria • Kill Feed" })
    .setTimestamp();
}

// ─── Ban ──────────────────────────────────────────────────────────────────────
export function buildBanEmbed(opts: {
  playerName: string;
  steamId: string;
  reason: string;
  duration: string;
  expiresAt: Date | null;
  admin: User;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLOR_BAN)
    .setTitle("🔨  Banimento Aplicado")
    .setDescription(
      `O jogador **${opts.playerName}** foi **banido** do servidor por decisão administrativa.\n\n` +
      `Para recorrer desta decisão, o jogador deve acessar **${APPEAL_LINK}** e abrir um ticket de recurso.`
    )
    .addFields(
      { name: "👤 Jogador no Servidor", value: opts.playerName, inline: true },
      { name: "🔑 Steam ID",            value: `\`${opts.steamId}\``, inline: true },
      { name: "\u200B",                 value: "\u200B", inline: true },
      { name: "⏱️ Duração",             value: durationLabel(opts.duration), inline: true },
      { name: "📅 Expira em",           value: formatExpiry(opts.expiresAt), inline: true },
      { name: "\u200B",                 value: "\u200B", inline: true },
      { name: "📋 Motivo",              value: opts.reason },
      { name: "🔗 Recurso",             value: `[${APPEAL_LINK}](https://${APPEAL_LINK})`, inline: true },
      { name: "👮 Banido por",          value: `<@${opts.admin.id}> (${opts.admin.tag})`, inline: true },
      { name: "🗓️ Data/Hora",          value: ptBR(new Date()), inline: true },
    )
    .setFooter({ text: "Sistema de Moderação — Registro Permanente" })
    .setTimestamp();
}

// ─── Kick ─────────────────────────────────────────────────────────────────────
export function buildKickEmbed(opts: {
  playerName: string;
  steamId: string;
  reason: string;
  admin: User;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLOR_KICK)
    .setTitle("👢  Expulsão Aplicada")
    .setDescription(
      `O jogador **${opts.playerName}** foi **expulso** do servidor. Pode reconectar normalmente.\n\n` +
      `Caso considere a ação injusta, pode abrir um ticket em **${APPEAL_LINK}**.`
    )
    .addFields(
      { name: "👤 Jogador no Servidor", value: opts.playerName, inline: true },
      { name: "🔑 Steam ID",            value: `\`${opts.steamId}\``, inline: true },
      { name: "\u200B",                 value: "\u200B", inline: true },
      { name: "📋 Motivo",              value: opts.reason },
      { name: "🔗 Recurso",             value: `[${APPEAL_LINK}](https://${APPEAL_LINK})`, inline: true },
      { name: "👮 Expulso por",         value: `<@${opts.admin.id}> (${opts.admin.tag})`, inline: true },
      { name: "🗓️ Data/Hora",          value: ptBR(new Date()), inline: true },
    )
    .setFooter({ text: "Sistema de Moderação — Registro Permanente" })
    .setTimestamp();
}

// ─── Verify ───────────────────────────────────────────────────────────────────
export function buildVerifyEmbed(opts: {
  playerName: string;
  steamId: string;
  discordUser: User;
  admin: User;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLOR_VERIFY)
    .setTitle("✅  Jogador Verificado")
    .setDescription(
      `O jogador **${opts.playerName}** passou pelo processo de triagem administrativa e foi **aprovado**.\n\n` +
      `Após análise detalhada, não foram identificados quaisquer indícios de softwares de trapaça (cheats), ` +
      `modificações não autorizadas ou irregularidades no dispositivo do jogador. ` +
      `Em virtude disso, o jogador foi considerado **limpo** e recebeu o cargo de **Verificado** no servidor.`
    )
    .addFields(
      { name: "👤 Jogador no Servidor", value: opts.playerName, inline: true },
      { name: "🔑 Steam ID",            value: `\`${opts.steamId}\``, inline: true },
      { name: "\u200B",                 value: "\u200B", inline: true },
      { name: "💬 Membro Discord",      value: `<@${opts.discordUser.id}> (${opts.discordUser.tag})`, inline: true },
      { name: "🛡️ Status",             value: "✅ Aprovado — Sem irregularidades", inline: true },
      { name: "🎖️ Cargo Concedido",    value: "**Verificado**", inline: true },
      { name: "👮 Verificado por",      value: `<@${opts.admin.id}> (${opts.admin.tag})`, inline: true },
      { name: "🗓️ Data/Hora",          value: ptBR(new Date()), inline: true },
    )
    .setFooter({ text: "Sistema de Verificação — Servidor Limpo" })
    .setTimestamp();
}

// ─── Unban ────────────────────────────────────────────────────────────────────
export function buildUnbanEmbed(opts: {
  playerName: string;
  steamId: string;
  reason: string;
  admin: User;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLOR_UNBAN)
    .setTitle("🔓  Banimento Removido")
    .setDescription(
      `O banimento de **${opts.playerName}** foi removido manualmente por um administrador. ` +
      `O jogador poderá acessar o servidor normalmente a partir deste momento.`
    )
    .addFields(
      { name: "👤 Jogador",         value: opts.playerName, inline: true },
      { name: "🔑 Steam ID",        value: `\`${opts.steamId}\``, inline: true },
      { name: "\u200B",             value: "\u200B", inline: true },
      { name: "📋 Motivo",          value: opts.reason },
      { name: "👮 Desbanido por",   value: `<@${opts.admin.id}> (${opts.admin.tag})`, inline: true },
      { name: "🗓️ Data/Hora",      value: ptBR(new Date()), inline: true },
    )
    .setFooter({ text: "Sistema de Moderação — Registro Permanente" })
    .setTimestamp();
}

// ─── Auto-unban ───────────────────────────────────────────────────────────────
export function buildAutoUnbanEmbed(opts: {
  playerName: string;
  steamId: string;
  originalReason: string;
  duration: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x95a5a6)
    .setTitle("🔓  Banimento Expirado — Desbloqueio Automático")
    .setDescription(
      `O banimento de **${opts.playerName}** chegou ao fim. O jogador foi desbloqueado automaticamente pelo sistema.`
    )
    .addFields(
      { name: "👤 Jogador",              value: opts.playerName, inline: true },
      { name: "🔑 Steam ID",             value: `\`${opts.steamId}\``, inline: true },
      { name: "\u200B",                  value: "\u200B", inline: true },
      { name: "⏱️ Duração cumprida",    value: durationLabel(opts.duration), inline: true },
      { name: "📋 Motivo original",      value: opts.originalReason, inline: true },
      { name: "🗓️ Data/Hora",           value: ptBR(new Date()), inline: true },
    )
    .setFooter({ text: "Sistema de Moderação — Desbloqueio Automático" })
    .setTimestamp();
}
