import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { auditWipe, buildWipePlan, diagnoseHost, executeWipe, type WipeKind } from "../../core/hostWipe.js";

export const data = new SlashCommandBuilder()
  .setName("wipe")
  .setDescription("Diagnostica e prepara o wipe do servidor (modo seguro).")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(sub=>sub.setName("diagnostico").setDescription("Testa a API e mostra o estado, sem alterar arquivos."))
  .addSubcommand(sub=>sub.setName("planejar").setDescription("Lista exatamente o que seria removido.").addStringOption(opt=>opt.setName("tipo").setDescription("Tipo de wipe").setRequired(true).addChoices(
    {name:"Somente mapa",value:"map"},{name:"Mapa + jogadores",value:"map_players"},{name:"Completo + blueprints",value:"full"}
  )))
  .addSubcommand(sub=>sub.setName("executar").setDescription("Execução protegida (bloqueada até o dia do wipe).")
    .addStringOption(opt=>opt.setName("tipo").setDescription("Tipo de wipe").setRequired(true).addChoices({name:"Somente mapa",value:"map"},{name:"Mapa + jogadores",value:"map_players"},{name:"Completo + blueprints",value:"full"}))
    .addStringOption(opt=>opt.setName("confirmacao").setDescription("Digite WIPE GUERRA FRIA").setRequired(true)));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const actor={id:interaction.user.id,name:interaction.user.tag}; const sub=interaction.options.getSubcommand();
  try {
    if(sub==="diagnostico"){
      const d=await diagnoseHost(); await auditWipe("WIPE_DIAGNOSTIC",actor,"Diagnóstico somente leitura executado pelo Discord.");
      await interaction.editReply({embeds:[new EmbedBuilder().setColor(0xf4c45a).setTitle("🛡️ Diagnóstico do wipe").setDescription("Nenhum arquivo foi alterado.").addFields(
        {name:"Servidor",value:d.server.name,true},{name:"Estado",value:d.server.state,true},{name:"Arquivos",value:d.capabilities.files?"Acesso confirmado":"Indisponível",true},{name:"Execução destrutiva",value:d.capabilities.destructiveEnabled?"Habilitada":"🔒 Bloqueada",true}
      ).setTimestamp()]}); return;
    }
    const kind=interaction.options.getString("tipo",true) as WipeKind;
    if(sub==="planejar"){
      const p=await buildWipePlan(kind);await auditWipe("WIPE_PLAN",actor,`${kind}: ${p.files.length} arquivos, nenhuma alteração.`);
      const preview=p.files.slice(0,20).map(f=>`• \`${f.path}\``).join("\n")||"Nenhum arquivo compatível encontrado.";
      await interaction.editReply({embeds:[new EmbedBuilder().setColor(0xf4c45a).setTitle("📋 Plano de wipe — simulação").setDescription(`${preview}${p.files.length>20?`\n… e mais ${p.files.length-20}.`:""}`).addFields(
        {name:"Tipo",value:kind,true},{name:"Arquivos",value:String(p.files.length),true},{name:"Diretórios",value:String(p.directories.length),true},{name:"Segurança",value:"🔒 Nenhuma exclusão permitida",false}
      ).setTimestamp()]});return;
    }
    await executeWipe(kind,interaction.options.getString("confirmacao",true),actor);
  } catch(error:any){await interaction.editReply({embeds:[new EmbedBuilder().setColor(0xd64545).setTitle("🔒 Ação bloqueada").setDescription(error?.message||"Falha no sistema de wipe.").setTimestamp()]});}
}
