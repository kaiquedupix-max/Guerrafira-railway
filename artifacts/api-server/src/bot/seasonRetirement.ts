import { type Client, type GuildMember } from "discord.js";
import { withAdminServer } from "../core/adminServerContext.js";
import { ranksForSeason } from "../routes/seasonRanks.js";
import { executeRconCommand } from "./utils/rcon.js";
import { logger } from "../lib/logger.js";

const INTERVAL_MS = 10 * 60_000;
const RANK_GROUPS = [...new Set([
  "season_recruta",
  ...ranksForSeason(1).map(rank => rank.group),
  ...ranksForSeason(2).map(rank => rank.group),
])];
const LEGACY_ROLE_IDS = new Set([
  "1544028734632231014", "1544029353132695674", "1544029683270684775",
  "1544029869015433278", "1544030006194208858",
]);
const SEASON_NICK_TAG = /^(?:\[(?:SLD|TEN|MAJ|MJR|MAR|GFR|RCT|SL[123]|SG[123]|TN[123]|CL[123])\]\s*)+/i;

let gameDone = false;
let gameRunning = false;
let gameTimer: NodeJS.Timeout | null = null;
let discordDone = false;
let discordRunning = false;
let discordTimer: NodeJS.Timeout | null = null;

function isSeasonRole(name: string): boolean {
  return /^(?:season(?:\s|[_:-]|\d)|s[12]\s*[•:-])/i.test(name.trim());
}

async function retireGameServer(server: "solo-duo" | "trio"): Promise<boolean> {
  return withAdminServer(server, async () => {
    const listing = await executeRconCommand("chat group list");
    if (listing === null || !/groups?|grupos?/i.test(listing)) {
      logger.warn({ server, response: listing?.slice(0, 200) }, "Não foi possível confirmar os grupos Better Chat");
      return false;
    }
    const discovered = listing.match(/\bseason\d*_[a-z0-9_]+\b/gi) || [];
    const candidates = [...new Set([...RANK_GROUPS, ...discovered])].filter(group =>
      listing.toLowerCase().includes(group.toLowerCase())
    );
    let failures = 0;
    for (const group of candidates) {
      const reply = await executeRconCommand("chat group remove " + group);
      if (reply === null || /no permission|not allowed|unknown command|permission denied|sem permiss[aã]o|erro:/i.test(reply)) {
        failures++;
        logger.warn({ server, group, reply }, "Falha ao remover grupo antigo da Season");
      }
    }
    logger.info({ server, found: candidates.length, failures }, "Limpeza de grupos Better Chat da Season");
    return failures === 0;
  });
}

export async function retireSeasonGameOnce(): Promise<void> {
  if (gameRunning || gameDone) return;
  gameRunning = true;
  try {
    const duoOk = await retireGameServer("solo-duo");
    const trioOk = !process.env.TRIO_RCON_HOST ? false : await retireGameServer("trio");
    if (duoOk && trioOk) {
      gameDone = true;
      if (gameTimer) clearInterval(gameTimer);
      gameTimer = null;
    }
    logger.info({ duoOk, trioOk }, "Estado da remoção global das tags Season no Rust");
  } catch (error) {
    logger.error({ error }, "Falha na remoção de tags Season do Rust; tentativa será repetida");
  } finally {
    gameRunning = false;
  }
}

async function clearNickname(member: GuildMember): Promise<boolean> {
  if (!member.nickname || !SEASON_NICK_TAG.test(member.nickname)) return true;
  if (!member.manageable) {
    logger.warn({ discordId: member.id }, "Sem permissão para limpar antiga tag de Season do apelido");
    return false;
  }
  const name = member.nickname.replace(SEASON_NICK_TAG, "").trim();
  try {
    await member.setNickname(name ? name.slice(0, 32) : null, "Encerramento de todas as Seasons Guerra Fria");
    return true;
  } catch (error) {
    logger.warn({ error, discordId: member.id }, "Erro ao limpar tag antiga de Season");
    return false;
  }
}

export async function retireSeasonDiscordOnce(client: Client): Promise<void> {
  if (discordRunning || discordDone) return;
  discordRunning = true;
  try {
    const guildId = String(process.env.DISCORD_GUILD_ID || "").trim();
    if (!guildId) {
      logger.warn("DISCORD_GUILD_ID ausente; limpeza de cargos Season pendente");
      return;
    }
    const guild = await client.guilds.fetch(guildId);
    const allRoles = await guild.roles.fetch();
    const oldRoles = [...allRoles.values()].filter(role =>
      role && role.id !== guild.id && (LEGACY_ROLE_IDS.has(role.id) || isSeasonRole(role.name))
    );
    let removedRoles = 0;
    let failures = 0;
    for (const role of oldRoles) {
      if (!role?.editable || role.managed) {
        failures++;
        logger.warn({ roleId: role?.id, roleName: role?.name }, "Bot não pode excluir o cargo antigo da Season");
        continue;
      }
      try {
        await role.delete("Encerramento do sistema Season; substituído por Guerra Fria Invaders");
        removedRoles++;
      } catch (error) {
        failures++;
        logger.warn({ error, roleId: role.id }, "Não foi possível excluir cargo Season");
      }
    }
    const members = await guild.members.fetch();
    let renamed = 0;
    for (const member of members.values()) {
      if (member.user.bot || !member.nickname || !SEASON_NICK_TAG.test(member.nickname)) continue;
      if (await clearNickname(member)) renamed++;
      else failures++;
    }
    if (!failures) {
      discordDone = true;
      if (discordTimer) clearInterval(discordTimer);
      discordTimer = null;
    }
    logger.info({ rolesFound: oldRoles.length, removedRoles, renamed, failures }, "Remoção global de cargos e tags Season no Discord");
  } catch (error) {
    logger.error({ error }, "Falha na limpeza Season do Discord; tentativa será repetida");
  } finally {
    discordRunning = false;
  }
}

export function startSeasonGameRetirement(): void {
  if (gameDone || gameTimer) return;
  void retireSeasonGameOnce();
  gameTimer = setInterval(() => void retireSeasonGameOnce(), INTERVAL_MS);
  gameTimer.unref?.();
}

export function startSeasonDiscordRetirement(client: Client): void {
  if (discordDone || discordTimer) return;
  void retireSeasonDiscordOnce(client);
  discordTimer = setInterval(() => void retireSeasonDiscordOnce(client), INTERVAL_MS);
  discordTimer.unref?.();
}
