import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction, type ModalSubmitInteraction } from "discord.js";
import { db, boosterLinksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { VIP_TIERS, type VipTier } from "./vip.js";
import { handleVipModal as continueVipModal } from "./tickets.js";

export async function openVipModal(interaction: ButtonInteraction): Promise<void> {
  const raw = interaction.customId.replace("vip_select_", "");
  const tier = (raw === "teste" ? "prata" : raw) as VipTier;
  const vip = VIP_TIERS[tier];
  if (!vip) return;
  const [saved] = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, interaction.user.id)).limit(1);
  const price = raw === "teste" ? parseFloat(process.env.VIP_PRATA_TEST_PRICE ?? "1.00") : vip.price;
  const steam = new TextInputBuilder().setCustomId("steam_id").setLabel(saved ? "Steam vinculada — não altere" : "Seu Steam ID (SteamID64)").setStyle(TextInputStyle.Short).setMinLength(17).setMaxLength(17).setRequired(true);
  if (saved) steam.setValue(saved.steamId); else steam.setPlaceholder("76561198XXXXXXXXX");
  const email = new TextInputBuilder().setCustomId("email").setLabel("Seu e-mail").setStyle(TextInputStyle.Short).setRequired(true);
  const modal = new ModalBuilder().setCustomId(`vip_modal_${raw}`).setTitle(`${vip.emoji} ${vip.name} — R$ ${price.toFixed(2)}`).addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(steam), new ActionRowBuilder<TextInputBuilder>().addComponents(email));
  await interaction.showModal(modal);
}

export async function submitVipModal(interaction: ModalSubmitInteraction): Promise<void> {
  const steamId = interaction.fields.getTextInputValue("steam_id").trim();
  const [saved] = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, interaction.user.id)).limit(1);
  if (saved && saved.steamId !== steamId) {
    await interaction.reply({ content: `🔒 Sua conta já possui a Steam \`${saved.steamId}\` vinculada. Para alterar, abra um ticket com a administração.`, ephemeral: true });
    return;
  }
  const [owner] = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.steamId, steamId)).limit(1);
  if (owner && owner.discordUserId !== interaction.user.id) {
    await interaction.reply({ content: "❌ Este SteamID já está vinculado a outra conta. Abra um ticket com a administração.", ephemeral: true });
    return;
  }
  if (!saved) await db.insert(boosterLinksTable).values({ discordUserId: interaction.user.id, steamId, active: false, updatedAt: new Date() });
  await continueVipModal(interaction);
}
