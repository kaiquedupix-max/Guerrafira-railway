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
import { discordClient } from "../bot/client.js";
import { logger } from "../lib/logger.js";
import { fetchMpPayment, processMpPayment } from "./paymentReconciler.js";
import { processPromoPayment } from "./promo.js";

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
  if (!client) { logger.error("Mercado Pago log não enviado: cliente do Discord ainda não está disponível"); return; }
  if (!channelId) { logger.error("Mercado Pago log não enviado: configure MP_LOG_CHANNEL_ID no Railway"); return; }
  const channel = await client.channels.fetch(channelId).catch((err) => {
    logger.error({ err, channelId }, "Mercado Pago log não enviado: falha ao buscar canal do Discord"); return null;
  });
  if (!channel?.isSendable()) { logger.error({ channelId }, "Mercado Pago log não enviado: canal não é enviável ou bot não tem permissão"); return; }

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
    .setFooter({ text: "Guerra Fria • Mercado Pago Webhook" }).setTimestamp();

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
  try { await channel.send({ embeds: [embed] }); logger.info({ channelId, type, action, dataId }, "Mercado Pago Discord log enviado"); }
  catch (err) { logger.error({ err, channelId }, "Falha ao enviar log do Mercado Pago ao Discord"); }
}

router.post("/mercadopago", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const dataId = getDataId(req, body);
  logger.info({ type: body.type, action: body.action, dataId, signatureValidation: "disabled" }, "MP webhook received");
  res.status(200).json({ received: true });
  try {
    const type = body.type as string | undefined;
    const action = body.action as string | undefined;
    const isPaymentNotification = type === "payment" || (typeof action === "string" && action.startsWith("payment."));
    if (!isPaymentNotification || !dataId) { await sendDiscordWebhookLog({ body, req, dataId }); return; }
    const mpData = await fetchMpPayment(dataId);
    await sendDiscordWebhookLog({ body, req, dataId, payment: mpData });
    if (!mpData) return;
    const handledByPromo = await processPromoPayment(mpData);
    if (!handledByPromo) await processMpPayment(mpData);
  } catch (err) {
    logger.error({ err }, "Webhook processing error");
  }
});

export default router;
