import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, type ChatInputCommandInteraction, type AutocompleteInteraction } from "discord.js";
import { adminServer, withAdminServer } from "../../core/adminServerContext.js";
import { searchPlayers } from "../utils/players.js";
import { banWithAssociation, resolveBanTeam } from "../../core/teamModeration.js";
const ANONYMOUS_MODERATOR_ROLE_ID="1538735197611360347",ANONYMOUS_MODERATOR_LABEL="Equipe de Moderação";
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

export const data=new SlashCommandBuilder().setName("banir").setDescription("Banir Steam e IP nos dois servidores, com time automático opcional")
 .addStringOption(o=>o.setName("jogador").setDescription("Escolha pelo nome ou informe a Steam").setRequired(true).setAutocomplete(true))
 .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);
export async function autocomplete(i:AutocompleteInteraction):Promise<void>{
 const q=i.options.getFocused().trim(),rows=await searchPlayers(q,24);
 const choices=rows.map(p=>({name:`${p.isOnline?"🟢":"⚫"} ${p.playerName}`.slice(0,100),value:p.steamId}));
 if(/^7656119\d{10}$/.test(q)&&!choices.some(p=>p.value===q))choices.unshift({name:"Banir Steam informada",value:q});
 await i.respond(choices.slice(0,25));
}
export async function execute(interaction:ChatInputCommandInteraction):Promise<void>{
 await interaction.deferReply({flags:MessageFlags.Ephemeral});
 if(!interaction.inGuild()||!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)){await interaction.editReply("Sem permissão para banir.");return;}
 const steamId=interaction.options.getString("jogador",true),server=adminServer();
 let duration:"3d"|"7d"|"30d"|"perm"="perm",reasonKey="cheat",association=false,finished=false,busy=false,details="";
 let roster:{steamId:string;name:string}[]=[];
 const select=(id:string,label:string,options:{label:string;value:string}[],value:string)=>new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(label).addOptions(options.map(o=>({...o,default:o.value===value}))));
 const panel=()=>({content:`**Banir jogador • ${server==="trio"?"Trio":"Solo/Duo"}**\nO banimento de Steam e IP vale no **Duo e Trio**.\nMotivo: ${STANDARD_BAN_REASONS.find(r=>r.value===reasonKey)?.label}\n${association?"Time incluído automaticamente: "+roster.map(p=>p.name).join(", "):"Somente o jogador selecionado."}`.slice(0,1900),components:[
 select("ban_reason","Motivo",STANDARD_BAN_REASONS.map(r=>({label:r.label,value:r.value})),reasonKey),
 select("ban_duration","Duração",[{label:"3 dias",value:"3d"},{label:"7 dias",value:"7d"},{label:"30 dias",value:"30d"},{label:"Permanente",value:"perm"}],duration),
 new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("ban_team").setLabel(association?"Time incluído ✓":"Incluir time por associação").setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId("ban_details").setLabel("Detalhes do motivo").setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId("ban_confirm").setLabel("Confirmar banimento").setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId("ban_cancel").setLabel("Cancelar").setStyle(ButtonStyle.Secondary))]});
 const message=await interaction.editReply(panel());
 const collector=message.createMessageComponentCollector({time:180000,filter:i=>i.user.id===interaction.user.id&&i.customId.startsWith("ban_")});
 collector.on("collect",i=>{void withAdminServer(server,async()=>{
   if(finished||busy){await i.deferUpdate();return;}busy=true;
   try{
     if(i.customId==="ban_details"){
       const modalId="ban_details_"+i.id;
       await i.showModal(new ModalBuilder().setCustomId(modalId).setTitle("Detalhes do motivo").addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("details").setLabel("Descreva o motivo").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(250))));
       const reply=await i.awaitModalSubmit({time:120000,filter:m=>m.customId===modalId&&m.user.id===interaction.user.id}).catch(()=>null);
       if(reply){await reply.deferUpdate();details=reply.fields.getTextInputValue("details").trim();await interaction.editReply(panel());}return;
     }
     await i.deferUpdate();
     if(i.customId==="ban_cancel"){finished=true;collector.stop();await interaction.editReply({content:"Banimento cancelado.",components:[]});return;}
     if(i.isStringSelectMenu()){if(i.customId==="ban_reason")reasonKey=i.values[0];if(i.customId==="ban_duration")duration=i.values[0] as typeof duration;}
     if(i.customId==="ban_team"){if(association){association=false;roster=[];}else{roster=await resolveBanTeam(steamId);association=true;}}
     if(i.customId!=="ban_confirm"){await interaction.editReply(panel());return;}
     if(association){const current=await resolveBanTeam(steamId);if(current.map(p=>p.steamId).sort().join()!==roster.map(p=>p.steamId).sort().join()){roster=current;await interaction.editReply(panel());await i.followUp({content:"O time mudou. Revise os nomes e confirme novamente.",flags:MessageFlags.Ephemeral});return;}}
     if(reasonKey==="other"&&!details)throw new Error("Informe os detalhes ao escolher Outro.");
     const member=await interaction.guild!.members.fetch({user:interaction.user.id,force:true});
     if(!member.permissions.has(PermissionFlagsBits.BanMembers))throw new Error("Você não tem mais permissão para banir.");
     finished=true;collector.stop();await interaction.editReply({content:"Aplicando banimentos no Duo e Trio…",components:[]});
     const result=await banWithAssociation({steamId,duration,reason:(STANDARD_BAN_REASONS.find(r=>r.value===reasonKey)?.label||"Decisão administrativa")+(details?" — "+details:""),actor:await moderationActor(interaction),association,expectedTeam:association?roster.map(p=>p.steamId):undefined});
     await interaction.editReply({content:`**${result.succeeded.length}/${result.total} jogadores confirmados no Duo e Trio.**\n${result.roster.map(p=>(result.succeeded.includes(p.steamId)?"✅ ":"⏳ ")+p.name).join("\n")}\n${result.ipUnknown.length?"IP ainda desconhecido de "+result.ipUnknown.length+" jogador(es); Steam banida.\n":""}${result.failed.map(p=>p.error).join("\n")}`.slice(0,2000),components:[]});
   }catch(error){await i.followUp({content:error instanceof Error?error.message:"Falha ao executar a ação.",flags:MessageFlags.Ephemeral}).catch(()=>{});}finally{busy=false;}
 }).catch(()=>{});});
 collector.on("end",()=>{if(!finished)void interaction.editReply({content:"Painel expirado. Abra /banir novamente.",components:[]}).catch(()=>{});});
}
