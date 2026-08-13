import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { VIP_TIERS } from "../vip.js";

export const data = new SlashCommandBuilder()
  .setName("ajuda")
  .setDescription("Mostra todos os comandos do bot e explica o que cada um faz.");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const isAdmin = interaction.memberPermissions?.has("BanMembers") ?? false;

  const prices = {
    bronze: VIP_TIERS.bronze.price.toFixed(2),
    prata: VIP_TIERS.prata.price.toFixed(2),
    ouro: VIP_TIERS.ouro.price.toFixed(2),
  };

  const geral = new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle("📖 Central de Ajuda — Guerra Fria")
    .setDescription("Sistema oficial de administração, VIP, Booster, vínculo Steam, leaderboard, tickets e integração com o servidor Rust.")
    .addFields(
      {
        name: "👤 COMANDOS GERAIS",
        value: [
          "`/ajuda` — abre esta central de ajuda.",
          "`/meuvip` — mostra seu VIP atual e data de expiração.",
          "`/leaderboard categoria` — consulta os rankings do wipe pelo Discord.",
          "🌐 O leaderboard completo também pode ser aberto pelo site oficial.",
        ].join("\n"),
      },
      {
        name: "🎮 VÍNCULO STEAM",
        value: [
          "O SteamID informado pela primeira vez fica **vinculado à conta do Discord**.",
          "Depois do vínculo, VIP, Booster e outras funções reutilizam a Steam automaticamente.",
          "🔒 O próprio jogador não pode trocar a Steam vinculada.",
          "🎫 Para solicitar alteração, é necessário abrir um ticket com a administração.",
        ].join("\n"),
      },
      {
        name: "👑 VIP",
        value: [
          `🥉 **Bronze** — R$ ${prices.bronze}/mês`,
          `🥈 **Prata** — R$ ${prices.prata}/mês`,
          `🥇 **Ouro** — R$ ${prices.ouro}/mês`,
          "💳 Compra via PIX ou cartão pelo Mercado Pago.",
          "✅ Após o pagamento, a ativação é automática.",
          "🔗 Quem já possui Steam vinculada não precisa informar o SteamID novamente.",
        ].join("\n"),
      },
      {
        name: "🚀 BOOSTER",
        value: [
          "O painel Booster verifica o impulso do Discord e aplica automaticamente os benefícios no Rust.",
          "🎮 Utiliza o SteamID já vinculado à conta quando disponível.",
          "♻️ Ao deixar de impulsionar, o grupo Booster é removido automaticamente do jogo.",
        ].join("\n"),
      },
      {
        name: "🎫 TICKETS",
        value: "Use o painel para **Suporte**, **Comprar VIP**, **Denunciar Jogador** ou **Apelar Banimento**.",
      },
    )
    .setFooter({ text: "Guerra Fria • Sistema oficial do servidor" })
    .setTimestamp();

  const embeds = [geral];

  if (isAdmin) {
    const admin1 = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("🛡️ Staff — Moderação e Jogadores")
      .addFields(
        {
          name: "⚔️ PUNIÇÕES",
          value: [
            "`/banir` — bane jogadores online ou offline, com motivo e duração.",
            "`/desbanir` — remove um banimento.",
            "`/kickar` — expulsa um jogador online.",
            "⏱️ Banimentos temporários são removidos automaticamente ao expirar.",
          ].join("\n"),
        },
        {
          name: "👥 JOGADORES",
          value: [
            "`/listaplayer` — lista jogadores online/offline registrados pelo bot.",
            "↳ Possui busca por nome/SteamID e paginação.",
            "`/verificar` — marca o jogador como verificado, concede cargo no Discord e grupo `vr` no Rust.",
            "🛡️ Jogadores verificados são ignorados pelos alertas do anti-cheat próprio.",
          ].join("\n"),
        },
        {
          name: "🎮 GERENCIAMENTO DE STEAM VINCULADA",
          value: [
            "`/steam consultar usuário` — mostra o SteamID vinculado e estado do Booster.",
            "`/steam trocar usuário novo_steamid motivo` — troca a Steam vinculada pela administração.",
            "↳ Se o Booster estiver ativo, transfere automaticamente o grupo `bs` para a nova Steam.",
            "`/steam desvincular usuário motivo` — remove completamente o vínculo Steam.",
            "⚠️ Use troca/desvinculação apenas após confirmar a solicitação do jogador pelo ticket.",
          ].join("\n"),
        },
        {
          name: "🚀 BOOSTER",
          value: [
            "Painel Booster — verifica o impulso e adiciona o jogador ao grupo `bs` no Rust.",
            "`/removerbooster steamid` — remove manualmente os benefícios Booster do SteamID.",
            "🔒 Para trocar Steam vinculada, use `/steam trocar`.",
          ].join("\n"),
        },
      );

    const admin2 = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("⚙️ Staff — VIP, Ranking e Sistemas")
      .addFields(
        {
          name: "👑 VIP",
          value: [
            "`/listvips` — lista os VIPs ativos.",
            "`/darvip` — concede VIP manualmente.",
            "`/removervip` — remove um VIP ativo.",
            "💳 Compras pelo Mercado Pago são processadas e ativadas automaticamente.",
          ].join("\n"),
        },
        {
          name: "🎉 SORTEIOS",
          value: [
            "`/criarsorteio` — cria sorteio de VIP com duração configurável.",
            "↳ O sistema escolhe o vencedor e entrega o prêmio automaticamente.",
          ].join("\n"),
        },
        {
          name: "📊 LEADERBOARD",
          value: [
            "`/leaderboard categoria` — consulta uma categoria no Discord.",
            "`/resetleaderboard` — zera as estatísticas do wipe após confirmação.",
            "🏆 O site possui Top 10 e ranking completo de combate, farm, raid e outras estatísticas.",
          ].join("\n"),
        },
        {
          name: "🛡️ ANTI-CHEAT PRÓPRIO",
          value: [
            "O sistema monitora automaticamente padrões de combate suspeitos e envia alertas para investigação da staff.",
            "✅ Não aplica ban automático.",
            "🔕 Jogadores já verificados pela administração são ignorados pelo detector.",
          ].join("\n"),
        },
        {
          name: "🗺️ MAPA & TICKETS",
          value: [
            "`/criarmapa` — cria/configura a votação de mapa.",
            "`/ticketlogs` — consulta históricos de tickets armazenados pelo bot.",
          ].join("\n"),
        },
      )
      .setFooter({ text: "Guerra Fria • Área administrativa" })
      .setTimestamp();

    embeds.push(admin1, admin2);
  }

  await interaction.reply({ embeds, ephemeral: true });
}
