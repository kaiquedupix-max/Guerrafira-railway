/**
 * Mercado Pago webhook handler.
 * Recebe TODOS os eventos em POST /webhook/mercadopago,
 * registra no Discord e processa pagamentos quando aplicável.
 *
 * Observação: a validação HMAC foi desativada por solicitação do administrador.
 * Pagamentos só são ativados após consulta à API oficial do Mercado Pago e
 * confirmação de status === "approved".
 */

import { Router, type Request, type Response } from "express";
import { EmbedBuilder } from "discord.js";
import { eq } from "drizzle-orm";
import { db, paymentsTable } from "@workspace/db";
import { grantVip, type VipTier } from "../bot/vip.js";
import { discordClient } from "../bot/client.js";
import { logger } from "../lib/logger.js";

const router = Router();

function text(value: unknown, fallback = "Não informado"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function truncate(value: string, max = 900): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function getDataId(req: Request, body: Record<string, unknown>): string {
  const queryValue = req.query["data.id"] ?? req.query.data_id;
  if (typeof queryValue === "string" && queryValue) return queryValue;

  const data = body.data as Record<string, unknown> | undefined;
  if (data?.id !== undefined && data?.id !== null) return String(data.id);

  return "";
}

async function sendDiscordWebhookLog(opts: {
  body: Record<string, unknown>;
  req: Request;
  dataId: string;
  payment?: Record<string, unknown> | null;
}): Promise<void> {
  const client = discordClient();
  const channelId = process.env.MP_LOG_CHANNEL_ID;

  if (!client) {
    logger.error("Mercado Pago log não enviado: cliente do Discord ainda não está disponível");
    return;
  }

  if (!channelId) {
    logger.error("Mercado Pago log não enviado: configure MP_LOG_CHANNEL_ID no Railway");
    return;
  }

  const channel = await client.channels.fetch(channelId).catch((err) => {
    logger.error({ err, channelId }, "Mercado Pago log não enviado: falha ao buscar canal do Discord");
    return null;
  });

  if (!channel?.isSendable()) {
    logger.error({ channelId }, "Mercado Pago log não enviado: canal não é enviável ou bot não tem permissão");
    return;
  }

  const { body, req, dataId, payment } = opts;
  const type = text(body.type, "desconhecido");
  const action = text(body.action, "sem ação");
  const liveMode = body.live_mode === true;

  let color = 0x3498db;
  const paymentStatus = payment?.status ? String(payment.status) : "";
  if (paymentStatus === "approved") color = 0x2ecc71;
  else if (paymentStatus === "rejected" || paymentStatus === "cancelled") color = 0xe74c3c;
  else if (paymentStatus === "pending" || paymentStatus === "in_process") color = 0xf1c40f;

  const rawJson = truncate(JSON.stringify(body, null, 2), 900);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle("💳 Mercado Pago • Evento recebido")
    .setDescription(`**${action}**`)
    .addFields(
      { name: "📨 Tipo", value: `\`${type}\``, inline: true },
      { name: "🆔 Data ID", value: `\`${dataId || "não informado"}\``, inline: true },
      { name: "🌐 Ambiente", value: liveMode ? "Produção" : "Teste", inline: true },
      { name: "🔐 Assinatura", value: "⚠️ Verificação desativada", inline: false },
      { name: "🔎 Request ID", value: `\`${truncate(req.header("x-request-id") ?? "não informado", 100)}\``, inline: false },
    )
    .setFooter({ text: "Guerra Fria • Mercado Pago Webhook" })
    .setTimestamp();

  if (payment) {
    const payer = (payment.payer ?? {}) as Record<string, unknown>;
    const method = (payment.payment_method ?? {}) as Record<string, unknown>;
    const transaction = (payment.transaction_details ?? {}) as Record<string, unknown>;

    embed.addFields(
      { name: "💰 Status", value: `\`${text(payment.status)}\``, inline: true },
      { name: "💵 Valor", value: `${text(payment.transaction_amount)} ${text(payment.currency_id, "BRL")}`, inline: true },
      { name: "💳 Método", value: text(method.id ?? payment.payment_method_id), inline: true },
      { name: "👤 Pagador", value: truncate(text(payer.email ?? payer.id), 250), inline: true },
      { name: "🏦 Valor líquido", value: text(transaction.net_received_amount), inline: true },
      { name: "🧾 Payment ID", value: `\`${text(payment.id)}\``, inline: true },
    );
  }

  embed.addFields({ name: "📦 Payload", value: `\`\`\`json\n${rawJson}\n\`\`\`` });

  try {
    await channel.send({ embeds: [embed] });
    logger.info({ channelId, type, action, dataId }, "Mercado Pago Discord log enviado");
  } catch (err) {
    logger.error({ err, channelId }, "Falha ao enviar log do Mercado Pago ao Discord");
  }
}

async function fetchMpPayment(paymentId: string): Promise<Record<string, unknown> | null> {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    logger.error("MP_ACCESS_TOKEN não configurado — não é possível confirmar pagamento");
    return null;
  }

  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    logger.error({ status: res.status, paymentId }, "Failed to fetch MP payment details");
    return null;
  }

  return res.json() as Promise<Record<string, unknown>>;
}

router.post("/mercadopago", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const dataId = getDataId(req, body);

  logger.info(
    { type: body.type, action: body.action, dataId, signatureValidation: "disabled" },
    "MP webhook received",
  );

  // Sempre reconhece o recebimento do webhook.
  res.status(200).json({ received: true });

  try {
    const type = body.type as string | undefined;
    const action = body.action as string | undefined;
    const isPaymentNotification =
      type === "payment" || (typeof action === "string" && action.startsWith("payment."));

    // Todos os eventos continuam sendo registrados no Discord.
    if (!isPaymentNotification || !dataId) {
      await sendDiscordWebhookLog({ body, req, dataId });
      return;
    }

    // A assinatura não é validada. O status do pagamento é confirmado pela API oficial.
    const mpData = await fetchMpPayment(dataId);
    await sendDiscordWebhookLog({ body, req, dataId, payment: mpData });

    if (!mpData) return;

    const status = mpData.status as string;
    const mpPayId = String(mpData.id);
    const metadata = (mpData.metadata ?? {}) as Record<string, string>;
    const mpPrefId = (mpData.preference_id as string | undefined) ?? "";

    let rec = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.mpPaymentId, mpPayId))
      .then((r) => r[0]);

    if (!rec && mpPrefId) {
      rec = await db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.mpPreferenceId, mpPrefId))
        .then((r) => r[0]);
    }

    if (!rec) {
      logger.warn({ mpPayId, mpPrefId, status }, "Payment record not found in DB — cannot process");
      return;
    }

    await db
      .update(paymentsTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(paymentsTable.id, rec.id));

    if (status === "approved") {
      const steamId = rec.steamId ?? metadata.steam_id ?? "";
      const discordUserId = rec.discordUserId ?? metadata.discord_user_id ?? "";
      const vipTier = (rec.vipTier ?? metadata.vip_tier ?? "") as VipTier;

      if (!steamId || !discordUserId || !vipTier) {
        logger.error({ recId: rec.id }, "Missing required fields for VIP grant");
        return;
      }

      const client = discordClient();
      if (!client) {
        logger.error("Discord client not available — cannot grant VIP");
        return;
      }

      await grantVip({
        discordUserId,
        steamId,
        tier: vipTier,
        durationDays: 30,
        source: "purchase",
        client,
      });

      if (rec.ticketChannelId) {
        const ch = await client.channels.fetch(rec.ticketChannelId).catch(() => null);
        if (ch?.isSendable()) {
          await ch.send(
            `✅ **Pagamento aprovado!** Seu **VIP ${vipTier}** foi ativado.\n` +
            `🎮 Steam ID: \`${steamId}\` • 📅 Válido por **30 dias**. Obrigado! 🙌`,
          );
        }
      }
    } else if (status === "rejected" || status === "cancelled") {
      const client = discordClient();
      if (rec.ticketChannelId && client) {
        const ch = await client.channels.fetch(rec.ticketChannelId).catch(() => null);
        if (ch?.isSendable()) {
          await ch.send(
            `❌ Pagamento **${status === "rejected" ? "recusado" : "cancelado"}**. ` +
            "Tente novamente ou escolha outro método.",
          );
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "Webhook processing error");
  }
});

export default router;
