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
    .setColor(0x5865f2)
    .setTitle("📖 Central de Ajuda — Guerra Fria")
    .setDescription("Lista atualizada dos comandos disponíveis no bot e suas funções.")
    .addFields(
      {
        name: "👤 COMANDOS GERAIS",
        value: [
          "`/ajuda` — abre esta central de ajuda com todos os comandos.",
          "`/meuvip` — mostra seu VIP atual, benefícios e data de expiração.",
          "`/leaderboard categoria` — consulta o ranking do servidor por categoria.",
          "↳ Kills, K/D, HS%, Farm e Explosivos.",
        ].join("\n"),
      },
      {
        name: "👑 VIP",
        value: [
          `🥉 **Bronze** — R$ ${prices.bronze}/mês`,
          `🥈 **Prata** — R$ ${prices.prata}/mês`,
          `🥇 **Ouro** — R$ ${prices.ouro}/mês`,
          "💳 Compra pelo sistema de tickets, com PIX ou cartão via Mercado Pago.",
          "✅ Após confirmação do pagamento, o VIP é ativado automaticamente.",
        ].join("\n"),
      },
      {
        name: "🎫 TICKETS",
        value: [
          "Use o painel de tickets para **Suporte Geral**, **Comprar VIP**, **Denunciar Jogador** ou **Apelar Banimento**.",
        ].join("\n"),
      },
    )
    .setFooter({ text: "Guerra Fria • Sistema oficial do servidor" })
    .setTimestamp();

  const embeds = [geral];

  if (isAdmin) {
    const admin1 = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("🛡️ Comandos da Staff — Moderação")
      .setDescription("Comandos administrativos disponíveis para a equipe.")
      .addFields(
        {
          name: "⚔️ PUNIÇÕES",
          value: [
            "`/banir` — bane jogadores **online ou offline** pelo histórico/SteamID, com motivo e duração.",
            "↳ Permite ban temporário ou permanente e registra a punição.",
            "`/desbanir` — remove o banimento de um jogador.",
            "`/kickar` — expulsa imediatamente um jogador que está online, sem bani-lo.",
          ].join("\n"),
        },
        {
          name: "👥 JOGADORES & VERIFICAÇÃO",
          value: [
            "`/listaplayer` — consulta jogadores registrados pelo bot, incluindo online e offline.",
            "↳ Permite pesquisar jogadores e consultar/copiar o SteamID.",
            "`/verificar` — verifica um jogador, dá o cargo Verificado no Discord e adiciona o SteamID ao grupo `vr` no Rust.",
          ].join("\n"),
        },
        {
          name: "🚀 BOOSTER",
          value: [
            "Painel Booster — vincula Discord + SteamID e adiciona o jogador ao grupo `bs` no Rust.",
            "`/removerbooster steamid` — remove manualmente o vínculo Booster.",
            "↳ Remove o SteamID do grupo `bs`, apaga o vínculo do banco e libera uma nova verificação.",
          ].join("\n"),
        },
        {
          name: "🗺️ MAPA",
          value: [
            "`/criarmapa` — cria/configura o sistema de votação de mapa do servidor.",
          ].join("\n"),
        },
      );

    const admin2 = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("👑 Comandos da Staff — VIP, Sorteios e Ranking")
      .addFields(
        {
          name: "👑 GERENCIAMENTO DE VIP",
          value: [
            "`/listvips` — lista os VIPs ativos e suas informações.",
            "`/darvip` — concede VIP manualmente, definindo membro, plano, SteamID e duração.",
            "↳ Registra o VIP e aplica os benefícios configurados.",
            "`/removervip` — remove manualmente um VIP ativo.",
          ].join("\n"),
        },
        {
          name: "🎉 SORTEIOS",
          value: [
            "`/criarsorteio` — cria um sorteio de VIP com prêmio e duração configuráveis.",
            "↳ O jogador participa pelo botão e o vencedor é escolhido automaticamente ao finalizar.",
          ].join("\n"),
        },
        {
          name: "📊 LEADERBOARD",
          value: [
            "`/leaderboard categoria` — consulta uma categoria do ranking.",
            "`/resetleaderboard` — apaga as estatísticas atuais e inicia um leaderboard zerado.",
            "⚠️ O reset solicita confirmação antes de apagar os dados.",
          ].join("\n"),
        },
        {
          name: "📋 LOGS DE TICKETS",
          value: [
            "`/ticketlogs` — consulta os registros/histórico de tickets armazenados pelo bot.",
          ].join("\n"),
        },
      )
      .setFooter({ text: "Guerra Fria • Área administrativa" })
      .setTimestamp();

    embeds.push(admin1, admin2);
  }

  await interaction.reply({ embeds, ephemeral: true });
}
