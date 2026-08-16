import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { auditWipe, buildWipePlan, diagnoseHost, executeWipe, type WipeKind } from "../../core/hostWipe.js";

export const data = new SlashCommandBuilder()
  .setName("wipe")
  .setDescription("Diagnostica e prepara o wipe do servidor (modo seguro).")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(sub=>sub.setName("diagnostico").setDescription("Testa a API e mostra o estado, sem alterar arquivos."))
  .addSubcommand(sub=>sub.setName("planejar").setDescription("Lista exatamente o que seria removido.").addStringOption(opt=>opt.setName("tipo").setDescription("Tipo de wipe").setRequired(true).addChoices(
    {name:"Wipe mapa",value:"map"},{name:"Wipe geral (mapa + BPs)",value:"general"}
  )).addStringOption(opt=>opt.setName("rustmaps").setDescription("Link do mapa no RustMaps ou download .map").setRequired(true)))
  .addSubcommand(sub=>sub.setName("mapa").setDescription("Wipa somente o mapa e instala o mapa informado.")
    .addStringOption(opt=>opt.setName("rustmaps").setDescription("Link do mapa no RustMaps ou download .map").setRequired(true))
    .addStringOption(opt=>opt.setName("confirmacao").setDescription("Digite WIPE GUERRA FRIA").setRequired(true)))
  .addSubcommand(sub=>sub.setName("geral").setDescription("Wipa mapa e blueprints e instala o mapa informado.")
    .addStringOption(opt=>opt.setName("rustmaps").setDescription("Link do mapa no RustMaps ou download .map").setRequired(true))
    .addStringOption(opt=>opt.setName("confirmacao").setDescription("Digite WIPE GUERRA FRIA").setRequired(true)));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const actor={id:interaction.user.id,name:interaction.user.tag}; const sub=interaction.options.getSubcommand();
  try {
    if(sub==="diagnostico"){
      const d=await diagnoseHost(); await auditWipe("WIPE_DIAGNOSTIC",actor,"Diagnóstico somente leitura executado pelo Discord.");
      await interaction.editReply({embeds:[new EmbedBuilder().setColor(0xf4c45a).setTitle("🛡️ Diagnóstico do wipe").setDescription("Nenhum arquivo foi alterado.").addFields(
        { name: "Servidor", value: String(d.server.name), inline: true },
        { name: "Estado", value: String(d.server.state), inline: true },
        { name: "Arquivos", value: d.capabilities.files ? "Acesso confirmado" : "Indisponível", inline: true },
        { name: "Execução destrutiva", value: d.capabilities.destructiveEnabled ? "Habilitada" : "🔒 Bloqueada", inline: true }
      ).setTimestamp()]}); return;
    }
    const kind=(sub==="geral"?"general":sub==="mapa"?"map":interaction.options.getString("tipo",true)) as WipeKind;
    if(sub==="planejar"){
      const p=await buildWipePlan(kind,interaction.options.getString("rustmaps",true));await auditWipe("WIPE_PLAN",actor,`${kind}: ${p.files.length} arquivos, nenhuma alteração.`);
      const preview=p.files.slice(0,20).map(f=>`• \`${f.path}\``).join("\n")||"Nenhum arquivo compatível encontrado.";
      await interaction.editReply({embeds:[new EmbedBuilder().setColor(0xf4c45a).setTitle("📋 Plano de wipe — simulação").setDescription(`${preview}${p.files.length>20?`\n… e mais ${p.files.length-20}.`:""}`).addFields(
        { name: "Tipo", value: kind, inline: true },
        { name: "Arquivos", value: String(p.files.length), inline: true },
        { name: "Diretórios", value: String(p.directories.length), inline: true },
        { name: "Segurança", value: "🔒 Nenhuma exclusão permitida", inline: false }
      ).setTimestamp()]});return;
    }
    await executeWipe(kind,interaction.options.getString("rustmaps",true),interaction.options.getString("confirmacao",true),actor);
  } catch(error:any){await interaction.editReply({embeds:[new EmbedBuilder().setColor(0xd64545).setTitle("🔒 Ação bloqueada").setDescription(error?.message||"Falha no sistema de wipe.").setTimestamp()]});}
}
