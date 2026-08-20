import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { auditWipe, buildWipePlan, diagnoseHost, executeProceduralWipe, type WipeKind } from "../../core/hostWipe.js";
import { runIsolatedVpsWipeTest } from "../../core/vpsWipeTest.js";
import { getWipeLockState, setWipeLock } from "../../core/wipeLock.js";

const TEST_PANEL_URL = "https://painel-gf.duckdns.org";
const TEST_SERVER_ID = "74ac18ef";

export const data = new SlashCommandBuilder()
  .setName("wipe")
  .setDescription("Diagnostica e prepara o wipe do servidor (modo seguro).")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(sub=>sub.setName("travar").setDescription("Trava imediatamente todas as execuções de wipe."))
  .addSubcommand(sub=>sub.setName("destravar").setDescription("Libera as execuções manuais e automáticas de wipe."))
  .addSubcommand(sub=>sub.setName("trava").setDescription("Mostra o estado atual da trava do wipe."))
  .addSubcommand(sub=>sub.setName("diagnostico").setDescription("Simula o wipe e testa permissões usando somente um arquivo temporário."))
  .addSubcommand(sub=>sub.setName("test").setDescription("Wipe de teste isolado somente na VPS nova, sem avisos públicos ou RCON.")
    .addIntegerOption(opt=>opt.setName("seed").setDescription("Seed do mapa de teste").setRequired(true).setMinValue(0).setMaxValue(2147483647))
    .addIntegerOption(opt=>opt.setName("size").setDescription("Size do mapa de teste").setRequired(true).setMinValue(1000).setMaxValue(6000))
    .addStringOption(opt=>opt.setName("confirmacao").setDescription("Digite TESTE VPS").setRequired(true)))
  .addSubcommand(sub=>sub.setName("planejar").setDescription("Lista exatamente o que seria removido.").addStringOption(opt=>opt.setName("tipo").setDescription("Tipo de wipe").setRequired(true).addChoices(
    {name:"Wipe mapa",value:"map"},{name:"Wipe geral (mapa + BPs)",value:"general"}
  )).addIntegerOption(opt=>opt.setName("seed").setDescription("Seed do novo mapa").setRequired(true).setMinValue(0).setMaxValue(2147483647)).addIntegerOption(opt=>opt.setName("size").setDescription("Size do novo mapa").setRequired(true).setMinValue(1000).setMaxValue(6000)))
  .addSubcommand(sub=>sub.setName("mapa").setDescription("Wipa somente o mapa usando seed e size.")
    .addIntegerOption(opt=>opt.setName("seed").setDescription("Seed do novo mapa").setRequired(true).setMinValue(0).setMaxValue(2147483647))
    .addIntegerOption(opt=>opt.setName("size").setDescription("Size do novo mapa").setRequired(true).setMinValue(1000).setMaxValue(6000))
    .addStringOption(opt=>opt.setName("confirmacao").setDescription("Digite WIPE GUERRA FRIA").setRequired(true)))
  .addSubcommand(sub=>sub.setName("geral").setDescription("Wipa mapa e blueprints usando seed e size.")
    .addIntegerOption(opt=>opt.setName("seed").setDescription("Seed do novo mapa").setRequired(true).setMinValue(0).setMaxValue(2147483647))
    .addIntegerOption(opt=>opt.setName("size").setDescription("Size do novo mapa").setRequired(true).setMinValue(1000).setMaxValue(6000))
    .addStringOption(opt=>opt.setName("confirmacao").setDescription("Digite WIPE GUERRA FRIA").setRequired(true)));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const actor={id:interaction.user.id,name:interaction.user.tag}; const sub=interaction.options.getSubcommand();
  try {
    if(sub==="travar"||sub==="destravar"){
      const state=await setWipeLock(sub==="destravar",`${interaction.user.tag} (${interaction.user.id})`);await auditWipe(state.unlocked?"WIPE_UNLOCKED":"WIPE_LOCKED",actor,`Trava alterada pelo Discord: ${state.unlocked?"liberado":"travado"}.`);
      await interaction.editReply({embeds:[new EmbedBuilder().setColor(state.unlocked?0x38c978:0xd64545).setTitle(state.unlocked?"🔓 Sistema de wipe destravado":"🔒 Sistema de wipe travado").setDescription(state.unlocked?"Execuções manuais e automáticas estão liberadas.":"Nenhum wipe poderá apagar arquivos enquanto a trava estiver ativa.").setTimestamp()]});return;
    }
    if(sub==="trava"){const state=await getWipeLockState();await interaction.editReply({embeds:[new EmbedBuilder().setColor(state.unlocked?0x38c978:0xd64545).setTitle(state.unlocked?"🔓 Wipe destravado":"🔒 Wipe travado").setDescription(state.updatedBy?`Última alteração: ${state.updatedBy}`:"Nenhuma alteração registrada.").setTimestamp()]});return;}
    if(sub==="diagnostico"){
      const d=await diagnoseHost(); await auditWipe("WIPE_DIAGNOSTIC",actor,"Diagnóstico somente leitura executado pelo Discord.");
      const allFiles=d.plans.general.files as Array<{path:string;group:string;size:number}>;
      const mapFiles=d.plans.map.files as Array<{path:string;group:string;size:number}>;
      const report=[
        "DIAGNÓSTICO DE WIPE — GUERRA FRIA",`Gerado: ${new Date().toISOString()}`,"",
        `Seed atual: ${d.currentMap.seed??"não identificada"}`,`Size atual: ${d.currentMap.size??"não identificado"}`,
        "",
        "ARQUIVOS REMOVIDOS NO WIPE DE MAPA",...mapFiles.map(f=>`${f.path} (${f.size} bytes)`),"",
        "ARQUIVOS REMOVIDOS NO WIPE GERAL",...allFiles.map(f=>`${f.path} [${f.group}] (${f.size} bytes)`),"",
        `Permissão listar/escrever/apagar: ${d.permissions.files.confirmed?"CONFIRMADA":"FALHOU"}`,
        `Seed editável (${d.seedVariable||"ausente"}): ${d.permissions.startup.seedEditable?"SIM":"NÃO"}`,
        `Size editável (${d.sizeVariable||"ausente"}): ${d.permissions.startup.sizeEditable?"SIM":"NÃO"}`,
        "",`Startup efetivo: ${d.startupCommand||"indisponível"}`,
      ].join("\n");
      const currentMaps=d.currentMap.mapFiles.map((f:any)=>`• \`${f.path}\``).join("\n").slice(0,1000)||"Nenhum arquivo .map encontrado.";
      await interaction.editReply({embeds:[new EmbedBuilder().setColor(d.capabilities.proceduralStartup&&d.permissions.files.confirmed?0x38c978:0xd64545).setTitle("🛡️ Diagnóstico completo do wipe").setDescription("Nenhum save foi alterado. Um arquivo temporário foi criado e apagado para testar as permissões reais.").addFields(
        { name: "Servidor", value: String(d.server.name), inline: true },
        { name: "Estado", value: String(d.server.state), inline: true },
        { name: "Seed atual", value: String(d.currentMap.seed??"Não identificada"), inline: true },
        { name: "Size atual", value: String(d.currentMap.size??"Não identificado"), inline: true },
        { name: "Permissão de arquivos", value: d.permissions.files.confirmed?"✅ Listar, escrever e apagar confirmados":"❌ Permissão incompleta", inline: false },
        { name: "Permissão de startup", value: `Seed (${d.seedVariable||"ausente"}): ${d.permissions.startup.seedEditable?"✅ editável":"❌ não editável"}\nSize (${d.sizeVariable||"ausente"}): ${d.permissions.startup.sizeEditable?"✅ editável":"❌ não editável"}`, inline: false },
        { name: "Mapa(s) .map atual(is)", value: currentMaps, inline: false },
        { name: "Simulação das exclusões", value: `Wipe mapa: **${mapFiles.length}** arquivos\nWipe geral: **${allFiles.length}** arquivos\nA lista completa está no arquivo anexado.`, inline: false },
        { name: "Execução destrutiva", value: d.capabilities.destructiveEnabled&&d.capabilities.wipeUnlocked ? "🔓 Habilitada" : "🔒 Bloqueada", inline: true }
      ).setTimestamp()],files:[{attachment:Buffer.from(report,"utf8"),name:`diagnostico-wipe-${Date.now()}.txt`} ]}); return;
    }
    if(sub==="test"){
      const configuredPanel=String(process.env.ELGAE_PANEL_URL||"").replace(/\/$/,"");
      const configuredServer=String(process.env.ELGAE_SERVER_ID||"").trim();
      if(configuredPanel!==TEST_PANEL_URL||configuredServer!==TEST_SERVER_ID){
        throw new Error("/wipe test bloqueado: as variáveis não apontam para a VPS de teste autorizada.");
      }
      if(interaction.options.getString("confirmacao",true)!=="TESTE VPS"){
        throw new Error("Confirmação inválida. Digite exatamente TESTE VPS.");
      }
      const seed=interaction.options.getInteger("seed",true),size=interaction.options.getInteger("size",true);
      await auditWipe("WIPE_TEST_STARTED",actor,`Teste isolado na VPS ${TEST_SERVER_ID}; seed ${seed}; size ${size}; sem avisos Discord e sem RCON.`);
      const result=await runIsolatedVpsWipeTest(seed,size);
      await auditWipe("WIPE_TEST_COMPLETED",actor,`Teste isolado concluído; seed ${result.seed}; size ${result.size}; mapa ${result.mapFile}; backup ${result.backupId}.`);
      await interaction.editReply({embeds:[new EmbedBuilder().setColor(0x38c978).setTitle("✅ Wipe de teste concluído na VPS").setDescription("O teste usou somente a API do Pterodactyl da VPS autorizada. Não usou RCON, não enviou aviso público e não resetou o leaderboard do servidor principal.").addFields(
        {name:"Servidor autorizado",value:`\`${TEST_SERVER_ID}\``,inline:true},
        {name:"Seed",value:`\`${result.seed}\``,inline:true},
        {name:"Size",value:`\`${result.size}\``,inline:true},
        {name:"Arquivos removidos",value:String(result.filesDeleted),inline:true},
        {name:"Mapa gerado",value:`\`${result.mapFile}\``,inline:false},
        {name:"Backup",value:`\`${result.backupId}\``,inline:false}
      ).setTimestamp()]});return;
    }
    const kind=(sub==="geral"?"general":sub==="mapa"?"map":interaction.options.getString("tipo",true)) as WipeKind;
    const seed=interaction.options.getInteger("seed",true),size=interaction.options.getInteger("size",true);
    if(sub==="planejar"){
      const p=await buildWipePlan(kind);await auditWipe("WIPE_PLAN",actor,`${kind}: ${p.files.length} arquivos; seed ${seed}; size ${size}; nenhuma alteração.`);
      const preview=p.files.slice(0,20).map(f=>`• \`${f.path}\``).join("\n")||"Nenhum arquivo compatível encontrado.";
      await interaction.editReply({embeds:[new EmbedBuilder().setColor(0xf4c45a).setTitle("📋 Plano de wipe — simulação").setDescription(`${preview}${p.files.length>20?`\n… e mais ${p.files.length-20}.`:""}`).addFields(
        { name: "Tipo", value: kind, inline: true },
        { name: "Arquivos", value: String(p.files.length), inline: true },
        { name: "Diretórios", value: String(p.directories.length), inline: true },
        { name: "Novo mapa", value: `Seed: \`${seed}\` • Size: \`${size}\``, inline: false },
        { name: "Segurança", value: "🔒 Nenhuma exclusão permitida", inline: false }
      ).setTimestamp()]});return;
    }
    await executeProceduralWipe(kind,seed,size,interaction.options.getString("confirmacao",true),actor);
  } catch(error:any){await interaction.editReply({embeds:[new EmbedBuilder().setColor(0xd64545).setTitle("🔒 Ação bloqueada").setDescription(error?.message||"Falha no sistema de wipe.").setTimestamp()]});}
}
