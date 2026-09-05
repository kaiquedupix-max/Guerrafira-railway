import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { db, modLogsTable } from "@workspace/db";
import { searchPlayers, getPlayerBySteamId } from "../utils/players.js";
import { ActionError } from "../../core/systemActions.js";
import { executeRconCommand } from "../utils/rcon.js";
import { logger } from "../../lib/logger.js";

const STEAM_ID_RE = /^7656119\d{10}$/;
const ANONYMOUS_MODERATOR_ROLE_ID = "1538735197611360347";
const ANONYMOUS_MODERATOR_LABEL = "Moderador do servidor";
function safe(value:string,max=180){return String(value??"").replace(/[\r\n\t"]/g," ").trim().slice(0,max);}
function safeChat(value:string,max=160){return safe(value,max).replace(/[<>]/g,"");}
async function moderatorName(interaction:ChatInputCommandInteraction):Promise<string>{
  const member=interaction.guild?await interaction.guild.members.fetch(interaction.user.id).catch(()=>null):null;
  return member?.roles.cache.has(ANONYMOUS_MODERATOR_ROLE_ID)?ANONYMOUS_MODERATOR_LABEL:interaction.user.tag;
}
async function dispatchRustCommand(command:string):Promise<void>{
  const pending=executeRconCommand(command);
  await Promise.race([pending.then(()=>undefined),new Promise<void>(resolve=>setTimeout(resolve,1200))]);
}

export const data=new SlashCommandBuilder()
  .setName("unmute").setDescription("Remove o mute de um jogador do chat do servidor")
  .addStringOption(opt=>opt.setName("jogador").setDescription("Pesquise pelo nome ou informe o SteamID64").setRequired(true).setAutocomplete(true))
  .addStringOption(opt=>opt.setName("motivo").setDescription("Motivo da remoção do mute").setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function autocomplete(interaction:AutocompleteInteraction):Promise<void>{
  const focused=interaction.options.getFocused().trim();
  const players=await searchPlayers(focused,25);
  const suggestions=players.map(p=>({name:`${p.isOnline?"🟢 ONLINE":"⚫ OFFLINE"} • ${p.playerName} — ${p.steamId}`.slice(0,100),value:p.steamId}));
  if(STEAM_ID_RE.test(focused)&&!suggestions.some(s=>s.value===focused))suggestions.unshift({name:`SteamID ${focused}`.slice(0,100),value:focused});
  await interaction.respond(suggestions.slice(0,25));
}

export async function execute(interaction:ChatInputCommandInteraction):Promise<void>{
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  try{
    const steamId=interaction.options.getString("jogador",true).trim();
    const reason=safe(interaction.options.getString("motivo")||"Mute removido pela administração",300);
    if(!STEAM_ID_RE.test(steamId))throw new ActionError("SteamID inválido.");
    const player=await getPlayerBySteamId(steamId);
    const playerName=safe(player?.playerName||`Jogador (${steamId})`,100);
    const adminName=await moderatorName(interaction);

    // O mute nativo do Rust não envia payload de confirmação via RCON.
    await dispatchRustCommand(`unmute ${steamId}`);
    await db.insert(modLogsTable).values({action:"UNMUTE",steamId,playerName,reason,adminId:interaction.user.id,adminName});
    void dispatchRustCommand(`say <color=#00FF88>[JOGADOR DESMUTADO]</color> | <color=#FF8800>${safeChat(playerName,80)}</color> teve o mute removido pelo administrador <color=#FF4444>${safeChat(adminName,60)}</color>. <color=#FFD166>Motivo:</color> <color=#FFFFFF>${safeChat(reason,140)}</color>`);
    await interaction.editReply(`✅ O mute de **${playerName}** foi removido.\n📝 Motivo: ${reason}`);
  }catch(error){
    logger.error({error},"Unmute command failed");
    await interaction.editReply(`❌ ${error instanceof ActionError?error.message:"Falha interna ao remover o mute do jogador."}`);
  }
}
