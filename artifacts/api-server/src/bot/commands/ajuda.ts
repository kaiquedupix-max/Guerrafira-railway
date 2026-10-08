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
 const lines=visible.sort((a,b)=>a.name.localeCompare(b.name)).flatMap(commandHelp);
 const embeds=[new EmbedBuilder().setColor(0xffb800).setTitle("Guerra Fria • Central de ajuda").setDescription([
  "**Loja oficial:** https://www.guerrafriarust.com.br/loja",
  "Compre VIP Bronze, Prata, Ouro e combos pelo site, com Steam e Discord autenticados. PIX e cartão Mercado Pago ficam no site; Stripe abre o checkout seguro externo.",
  "Escolha o servidor antes de pagar. Após a confirmação, o site mostra o estado da ativação e o bot envia o recibo no privado quando permitido.",
  "**Presentes:** envie o link exclusivo ao amigo. Ele entra com Steam e Discord para resgatar uma vez, dentro do prazo exibido. O Super Combo Duo ativa os três VIPs para o comprador e reserva os três para o amigo.",
  "**No jogo:** `/kit` abre os kits e seus itens. Permissões, cooldowns e limites de resgate são respeitados. A validade dos VIPs continua sendo gerenciada pelo bot.",
  "**Administração:** `/darvip` e `/removervip` exigem escolher Solo/Duo ou Trio. A remoção afeta a assinatura escolhida naquele servidor; outra assinatura ainda ativa continua valendo. `/listvips` e `/meuvip` mostram o servidor e o vencimento. `/removerbooster` usa o SteamID64 vinculado.",
  "Para corrigir o vínculo Steam, abra um ticket com a administração."
 ].join("\n\n"))];
 let page:string[]=[];let size=0;
 const push=()=>{if(page.length)embeds.push(new EmbedBuilder().setColor(0xffb800).setTitle("Comandos disponíveis • "+embeds.length).setDescription(page.join("\n")));page=[];size=0;};
 for(const line of lines){if(size+line.length+1>3500)push();page.push(line);size+=line.length+1;}push();
 await interaction.reply({embeds:[embeds[0]],ephemeral:true});
 for(const embed of embeds.slice(1))await interaction.followUp({embeds:[embed],ephemeral:true});
}
