import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { VIP_TIERS } from "../vip.js";

export const data = new SlashCommandBuilder()
  .setName("ajuda")
  .setDescription("Mostra todos os comandos disponíveis e o que cada um faz.");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const isAdmin = interaction.memberPermissions?.has("BanMembers") ?? false;

  const prices = {
    bronze: VIP_TIERS.bronze.price.toFixed(2),
    prata:  VIP_TIERS.prata.price.toFixed(2),
    ouro:   VIP_TIERS.ouro.price.toFixed(2),
  };

  const embedGeral = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📖  Comandos do Bot — Guerra Fria")
    .setDescription("Abaixo estão todos os comandos disponíveis para você.")
    .addFields(
      {
        name: "👤  Comandos Gerais",
        value: [
          "`/ajuda` — exibe esta mensagem de ajuda",
          "`/meuvip` — consulta seus VIPs ativos, data de expiração e benefícios",
          "`/leaderboard categoria` — exibe o ranking de jogadores do servidor",
          "  › Categorias: Top Kills, Maior KD, Maior HS%, Top Farm, Top Explosivos",
          "  › Resultado visível só para você",
        ].join("\n"),
      },
      {
        name: "👑  Sistema VIP",
        value: [
          "Para comprar VIP, abra um **ticket** no canal de suporte e selecione **Comprar VIP**.",
          "",
          `🥉 **VIP Bronze** — R$ ${prices.bronze}/mês`,
          (VIP_TIERS.bronze.benefits.map((b) => `  • ${b}`).join("\n")),
          "",
          `🥈 **VIP Prata** — R$ ${prices.prata}/mês`,
          (VIP_TIERS.prata.benefits.map((b) => `  • ${b}`).join("\n")),
          "",
          `🥇 **VIP Ouro** — R$ ${prices.ouro}/mês`,
          (VIP_TIERS.ouro.benefits.map((b) => `  • ${b}`).join("\n")),
          "",
          "💳 Pagamento via PIX ou Cartão (Mercado Pago). VIP ativado automaticamente após confirmação.",
        ].join("\n"),
      },
      {
        name: "🎫  Tickets de Suporte",
        value: [
          "Use o botão **Criar Ticket** no canal de suporte para abrir um ticket privado.",
          "Categorias disponíveis:",
          "  🛠️ Suporte Geral — dúvidas e bugs",
          "  👑 Comprar VIP — adquirir benefícios",
          "  🚨 Denunciar Jogador — reportar cheaters",
          "  ⚖️ Apelar Banimento — contestar punições",
        ].join("\n"),
      },
    )
    .setFooter({ text: "Guerra Fria • Use os comandos com responsabilidade" });

  const embeds = [embedGeral];

  if (isAdmin) {
    const embedAdmin = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("🔒  Comandos de Moderação")
      .setDescription("Visível apenas para administradores/moderadores.")
      .addFields(
        {
          name: "⚔️  Punições",
          value: [
            "`/banir` — bane um jogador do servidor via RCON com duração opcional",
            "  › Durações: 3 dias, 7 dias, 30 dias, Permanente",
            "  › Registra no log e no banco; auto-unban ao expirar",
            "`/desbanir` — remove o ban de um jogador (autocomplete mostra apenas banidos)",
            "`/kickar` — expulsa um jogador sem banir",
          ].join("\n"),
        },
        {
          name: "✅  Verificação",
          value: [
            "`/verificar @usuário` — atribui o cargo **Verificado** ao membro",
          ].join("\n"),
        },
        {
          name: "👑  VIP & Sorteios",
          value: [
            "`/listvips` — lista todos os VIPs ativos com Steam ID e data de expiração",
            "`/darvip @membro tier steam_id duracao` — concede VIP manual a um membro",
            "  › Aplica o VIP no jogo via RCON e atribui o cargo no Discord",
            "  › Duração em dias (1–365); registrado no banco e removido automaticamente ao expirar",
            "`/removervip` — remove o VIP de um membro (autocomplete mostra VIPs ativos)",
            "  › Revoga o VIP no jogo e remove o cargo no Discord",
            "`/criarsorteio premio duracao_vip duracao_sorteio` — cria um sorteio de VIP",
            "  › Anuncia no canal de sorteios e pinga no canal de anúncios",
            "  › Participação via botão com Steam ID",
            "  › Vencedor sorteado automaticamente ao expirar",
          ].join("\n"),
        },
        {
          name: "📊  Leaderboard & Jogadores",
          value: [
            "`/listaplayer` — lista todos os jogadores cadastrados (online e offline)",
            "  › Pesquisa por nome, paginação de 10 por vez, botão para copiar Steam ID",
            "`/resetleaderboard` — zera todas as estatísticas do leaderboard",
            "  › Solicita confirmação antes de executar; ideal para usar após cada wipe",
          ].join("\n"),
        },
        {
          name: "📋  Logs & Monitoramento",
          value: [
            "• **Canal de leaderboard** — rankings atualizados automaticamente a cada 10 min",
            "• **Canal de logs** — registra todos os bans, kicks, verificações e unbans",
            "• **Status do servidor** — embed atualizado a cada 60s com jogadores online, mapa e hora",
            "• **Chat bidirecional** — mensagens do jogo aparecem no Discord e vice-versa",
            "• **Slots automáticos** — servidor ajusta entre 100 e 250 slots conforme a fila",
          ].join("\n"),
        },
      )
      .setFooter({ text: "Guerra Fria • Comandos restritos a Admins/Mods" });

    embeds.push(embedAdmin);
  }

  await interaction.reply({ embeds, ephemeral: true });
}
