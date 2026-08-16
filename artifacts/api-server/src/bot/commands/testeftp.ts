import { AttachmentBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { testHostFileAccess } from "../../core/hostWipe.js";

export const data = new SlashCommandBuilder()
  .setName("testeftp")
  .setDescription("Testa criação, listagem e exclusão de um arquivo temporário na host.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction:ChatInputCommandInteraction):Promise<void>{
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  const actor={id:interaction.user.id,name:interaction.user.tag};
  try{
    const report=await testHostFileAccess(actor);
    const text=["RELATÓRIO DO TESTE DE ARQUIVOS — GUERRA FRIA",`Data: ${new Date().toISOString()}`,`Administrador: ${actor.name} (${actor.id})`,`Arquivo temporário: ${report.testPath}`,"",...report.steps,"",`Inventário (${report.inventory.length} entradas${report.truncated?", truncado em 1500":""}):`,...report.inventory].join("\n");
    const file=new AttachmentBuilder(Buffer.from(text,"utf8"),{name:"teste-arquivos-host.txt"});
    await interaction.editReply({embeds:[new EmbedBuilder().setColor(0x32d583).setTitle("✅ Teste de arquivos concluído").setDescription("O bot criou, encontrou, apagou e confirmou a remoção do arquivo temporário. O inventário completo está anexado.").addFields(
      {name:"Criação",value:report.created?"OK":"Falhou",inline:true},{name:"Listagem",value:report.visibleAfterCreate?"OK":"Falhou",inline:true},{name:"Exclusão",value:report.absentAfterDelete?"OK":"Falhou",inline:true},{name:"Entradas",value:String(report.inventory.length),inline:true}
    ).setFooter({text:"Nenhum arquivo existente foi alterado."}).setTimestamp()],files:[file]});
  }catch(error:any){
    const report=error?.testReport; const details=report?.steps?.join("\n")||error?.message||"Falha desconhecida";
    await interaction.editReply({embeds:[new EmbedBuilder().setColor(0xd64545).setTitle("❌ Teste de arquivos falhou").setDescription(`**Motivo:** ${error?.message||"Falha desconhecida"}\n\n```\n${String(details).slice(0,2500)}\n````).addFields({name:"Limpeza de segurança",value:"O bot tentou remover o arquivo temporário automaticamente no final."}).setTimestamp()]});
  }
}
