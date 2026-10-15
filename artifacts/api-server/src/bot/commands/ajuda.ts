import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, type ChatInputCommandInteraction } from "discord.js";
type Definition = { name:string; description:string; default_member_permissions?:string|null; options?:Definition[]; type?:number };
let definitions:Definition[]=[];
export function configureHelp(commands:unknown[]){ definitions=commands as Definition[]; }
export const data=new SlashCommandBuilder().setName("ajuda").setDescription("Lista os comandos disponíveis e explica a loja e os VIPs.");
export function commandHelp(command:Definition):string[]{
 const children=(command.options??[]).filter(o=>o.type===1||o.type===2);
 return children.length?children.flatMap(c=>commandHelp({...c,name:command.name+' '+c.name})):['`/'+command.name+'` — '+command.description];
}
export async function execute(interaction:ChatInputCommandInteraction):Promise<void>{
 const visible=definitions.filter(c=>!c.default_member_permissions||interaction.memberPermissions?.has(new PermissionsBitField(BigInt(c.default_member_permissions))));
 const has=(name:string)=>visible.some(c=>c.name===name);
 const embed=new EmbedBuilder().setColor(0xffb800).setTitle("Guerra Fria • Ajuda rápida").setDescription("Use **/menu** para abrir as funções com botões e busca por nome.");
 if(has("banir"))embed.addFields({name:"Moderação",value:"**/banir** → escolha o jogador, motivo e prazo. Para associação, clique em **Incluir time**: os nomes vêm do servidor. Steam e IP são bloqueados no **Duo e Trio**.\n**/desbanir** remove os dois bloqueios. **/kickar**, **/mute** e **/unmute** afetam o servidor escolhido."});
 embed.addFields({name:"Jogadores",value:"**/listaplayer** pesquisa por nome. **/duo** consulta o time. Escolha o servidor da consulta."},{name:"VIPs e suporte",value:"**/meuvip** consulta sua validade. Compre e resgate presentes na [loja oficial](https://www.guerrafriarust.com.br/loja). Para atendimento, abra um ticket."});
 await interaction.reply({embeds:[embed],ephemeral:true});
}
