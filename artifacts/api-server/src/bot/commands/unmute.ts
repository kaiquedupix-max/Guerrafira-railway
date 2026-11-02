import { moderateChat } from "../../core/chatModeration.js";
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { searchPlayers } from "../utils/players.js";
import { ActionError } from "../../core/systemActions.js";
import { logger } from "../../lib/logger.js";

const STEAM_ID_RE = /^7656119\d{10}$/;
const ANONYMOUS_MODERATOR_ROLE_ID = "1538735197611360347";
const ANONYMOUS_MODERATOR_LABEL = "Equipe de Moderação";
function safe(value:string,max=180){return String(value??"").replace(/[\r\n\t"]/g," ").trim().slice(0,max);}
async function moderatorName(interaction:ChatInputCommandInteraction):Promise<string>{
  const member=interaction.guild?await interaction.guild.members.fetch(interaction.user.id).catch(()=>null):null;
  if(member?.roles.cache.has(ANONYMOUS_MODERATOR_ROLE_ID))return ANONYMOUS_MODERATOR_LABEL;
  return member?.displayName?.trim()||interaction.user.globalName?.trim()||interaction.user.username?.trim()||"Administrador";
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
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) { await interaction.editReply("❌ Sem permissão para moderar jogadores."); return; }
  try{
    const steamId=interaction.options.getString("jogador",true).trim();
    const reason=safe(interaction.options.getString("motivo")||"Mute removido pela administração",300);
    if(!STEAM_ID_RE.test(steamId))throw new ActionError("SteamID inválido.");
    const result = await moderateChat({ steamId, reason, muted: false, actor: { id: interaction.user.id, name: await moderatorName(interaction), source: "discord" } });
    const playerName = result.playerName;
    await interaction.editReply(`✅ O mute de **${playerName}** foi removido.\n📝 Motivo: ${reason}`);
  }catch(error){
    logger.error({error},"Unmute command failed");
    await interaction.editReply(`❌ ${error instanceof ActionError?error.message:"Falha interna ao remover o mute do jogador."}`);
  }
}
