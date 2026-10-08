import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type ButtonInteraction, type ModalSubmitInteraction } from "discord.js";
import { VIP_STORE_URL } from "./vipArtwork.js";
export async function redirectVipToWebsite(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<void> {
  const payload={ embeds:[new EmbedBuilder().setColor(0xffb000).setTitle("👑 VIP na loja oficial").setDescription("Agora todas as compras são feitas pelo site. Entre com Discord e Steam, escolha seu VIP e pague com PIX ou cartão dentro da loja.")],
    components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Ver VIPs • Solo/Duo").setEmoji("🛡️").setURL(VIP_STORE_URL+"?server=solo-duo"))] };
  if(interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.reply({...payload,ephemeral:true});
}
