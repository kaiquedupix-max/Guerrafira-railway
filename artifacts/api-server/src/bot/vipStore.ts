import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type TextChannel, type Message } from "discord.js";
import { VIP_STORE_URL } from "./vipArtwork.js";
import { startBoosterSystem } from "./booster.js";
import { startDiscordModeration } from "./moderation.js";
import { logger } from "../lib/logger.js";
const VIP_KIT_UPDATE_MARKER="Guerra Fria • Kit VIP • cooldown 8h";
const VIP_STORE_MARKER="Guerra Fria • Loja VIP oficial";
const VIP_KIT_COOLDOWN_HOURS=8;
let moderationStarted=false;
async function announceVipKitCooldown(client: Client): Promise<void> {
  const channelId = process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID?.trim();
  if (!channelId) {
    logger.warn("VIP Kit cooldown announcement skipped — DISCORD_ANNOUNCEMENTS_CHANNEL_ID not configured");
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
  if (!channel?.isTextBased() || !channel.isSendable()) {
    logger.warn({ channelId }, "VIP Kit cooldown announcement channel unavailable");
    return;
  }

  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const alreadySent = recent?.some(message =>
    message.author.id === client.user?.id &&
    message.embeds.some(embed => embed.footer?.text?.includes(VIP_KIT_UPDATE_MARKER)),
  );

  if (alreadySent) return;

  const embed = new EmbedBuilder()
    .setColor(0xd6a934)
    .setTitle("⏱️ KIT VIP — COOLDOWN REDUZIDO")
    .setDescription(
      `O cooldown para resgatar novamente o **Kit VIP** agora é de apenas **${VIP_KIT_COOLDOWN_HOURS} horas**.\n\n` +
      "🎁 Aproveite seu benefício VIP com muito menos tempo de espera entre os resgates."
    )
    .setFooter({ text: VIP_KIT_UPDATE_MARKER })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  logger.info({ channelId }, "VIP Kit cooldown update announced");
}

export async function setupVipStore(client:Client):Promise<void> {
  if(!moderationStarted){startDiscordModeration(client);moderationStarted=true;}
  await startBoosterSystem(client).catch(err=>logger.error({err},"Booster initialization failed"));
  await announceVipKitCooldown(client).catch(err=>logger.error({err},"Cooldown announcement failed"));
  const channelId=process.env.DISCORD_VIP_STORE_CHANNEL_ID?.trim() || process.env.DISCORD_VIP_CHANNEL_ID?.trim() || "1530049713422729328";
  const channel=await client.channels.fetch(channelId).catch(()=>null) as TextChannel|null;
  if(!channel?.isTextBased() || !channel.isSendable()) return;
  if(process.env.DISCORD_GUILD_ID && channel.guildId!==process.env.DISCORD_GUILD_ID) {logger.error({channelId},"VIP channel belongs to unexpected guild");return;}

  const previous:Message[]=[];
  let before:string|undefined;
  // Discord returns at most 100 messages; walk the complete channel before deleting old store cards.
  for(;;){
    const page=await channel.messages.fetch({limit:100,...(before?{before}:{})});
    if(!page.size) break;
    previous.push(...page.filter(m=>m.author.id===client.user?.id && m.embeds.length>0).values());
    before=page.last()!.id;
    if(page.size<100) break;
  }

  const embed=new EmbedBuilder()
    .setColor(0xffb000)
    .setTitle("🛒 LOJA OFICIAL • GUERRA FRIA")
    .setDescription(
      "Garanta seu **VIP Guerra Fria** pela loja oficial. Confira benefícios, kits, preços e finalize com segurança pelo site.\n\n"+
      "🥉 **VIP Bronze** • 🥈 **VIP Prata** • 🥇 **VIP Ouro**\n"+
      "🎁 **Pacote 3 VIPs** • 👥 **Super Combo**\n\n"+
      "✅ **Solo/Duo:** compras liberadas\n"+
      "✅ **Trio:** compras liberadas • Super Combo para você + 2 amigos\n\n"+
      "🔐 Login com Discord + Steam\n💳 PIX e cartão"
    )
    .setFooter({text:VIP_STORE_MARKER});
  const art=new URL(VIP_STORE_URL);art.pathname="/api/store/art/store-banner";art.search="";embed.setImage(art.toString());
  const row=new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("COMPRAR VIP NA LOJA").setEmoji("🛒").setURL(VIP_STORE_URL)
  );

  const existing=previous.find(m=>m.embeds.some(e=>e.footer?.text===VIP_STORE_MARKER));
  const message=existing ? await existing.edit({embeds:[embed],components:[row]}) : await channel.send({embeds:[embed],components:[row]});

  // Keep one store advertisement only. This removes both legacy Solo/Duo and Trio cards.
  for(const old of previous) if(old.id!==message.id) await old.delete().catch(err=>logger.warn({err,messageId:old.id},"Old VIP card could not be removed"));
  logger.info({channelId},"Single VIP store advertisement synchronized");
}
