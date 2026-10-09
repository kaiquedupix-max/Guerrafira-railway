import {selectionName,storeQuote,type StoreSelection} from '../core/storePricing.js';
import { GUERRA_FRIA_SERVERS } from "../core/servers.js";
import { pool } from "@workspace/db";
import { discordClient } from "../bot/client.js";
import { VIP_PRODUCTS, isVipProduct } from "../bot/vipProducts.js";
import { duoToken } from "./duoPolicy.js";
import { logger } from "../lib/logger.js";
import { storeOrder } from "./storeOrders.js";
import { createHmac } from "node:crypto";
import { duoSecret } from "./duoPolicy.js";

let ready: Promise<void> | undefined;
export function ensureReceiptSchema(): Promise<void> {
  return ready ??= pool.query(`CREATE TABLE IF NOT EXISTS store_receipts (
    payment_id INTEGER PRIMARY KEY REFERENCES payments(id), completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ, lease_until TIMESTAMPTZ, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(), attempts INTEGER NOT NULL DEFAULT 0
  )`).then(() => {}).catch(error => { ready = undefined; throw error; });
}
// Called only AFTER the server and Discord benefits have been delivered.
export async function recordStoreDelivery(id: number): Promise<void> {
  await ensureReceiptSchema();
  await pool.query("INSERT INTO store_receipts(payment_id) VALUES($1) ON CONFLICT DO NOTHING", [id]);
}
export async function receiptState(id: number) {
  await ensureReceiptSchema();
  const { rows } = await pool.query("SELECT completed_at,sent_at,attempts FROM store_receipts WHERE payment_id=$1", [id]);
  return rows[0];
}
export async function sendStoreReceipts(): Promise<void> {
  const client = discordClient();
  if (!client) return;
  await ensureReceiptSchema();
  const { rows } = await pool.query(`UPDATE store_receipts SET lease_until=now()+interval '2 minutes',attempts=attempts+1
    WHERE payment_id IN (SELECT r.payment_id FROM store_receipts r JOIN payments p ON p.id=r.payment_id
      WHERE p.status='approved' AND r.sent_at IS NULL AND r.next_attempt_at<=now()
      AND (r.lease_until IS NULL OR r.lease_until<now()) ORDER BY r.completed_at LIMIT 30 FOR UPDATE OF r SKIP LOCKED)
    RETURNING payment_id`);
  for (const receipt of rows) {
    try {
      const payment = (await pool.query("SELECT * FROM payments WHERE id=$1 AND status='approved'", [receipt.payment_id])).rows[0];
      const productId: unknown = payment?.vip_tier;
      if (!payment || !isVipProduct(productId)) throw Error("Receipt unavailable");
      let claimUrl: string | null = null;let extraLinks:string[]=[];
      const order=await storeOrder(payment.id);
      if(order?.gift){
        const gift=(await pool.query('SELECT * FROM store_gifts WHERE payment_id=$1',[payment.id])).rows[0];
        if(gift?.status==='available'&&new Date(gift.expires_at).getTime()>Date.now())claimUrl=`https://www.guerrafriarust.com.br/api/store/gift/redeem#${createHmac('sha256',duoSecret()).update(`gift:${payment.id}:${gift.nonce}`).digest('base64url')}`;
      }else if (productId === "duo") {
        const claims = (await pool.query("SELECT * FROM duo_redemptions WHERE payment_id=$1 ORDER BY slot", [payment.id])).rows;
        const claim=claims[0];extraLinks=claims.slice(1).filter(c=>c.status==='available'&&new Date(c.expires_at).getTime()>Date.now()).map(c=>`https://www.guerrafriarust.com.br/api/store/duo/redeem#${duoToken(payment.id,c.nonce)}`);
        if (claim?.status === "available" && new Date(claim.expires_at).getTime() > Date.now())
          claimUrl = `https://www.guerrafriarust.com.br/api/store/duo/redeem#${duoToken(payment.id, claim.nonce)}`;
      }
      const user = await client.users.fetch(payment.discord_user_id);
      const description = `Seu pagamento foi confirmado automaticamente.\n**${storeQuote(productId,(order?.server_id||'solo-duo') as StoreSelection).name}**\n${order?.gift?'🎁 Seu presente está pronto! O VIP será ativado na conta do amigo após o resgate.':'✅ Seus benefícios já estão ativos no **'+selectionName((order?.server_id||'solo-duo') as StoreSelection)+'**, por **30 dias**.\nSteam: **'+payment.steam_id+'**'}\nCompra **#${payment.id}** • **${Number(payment.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}**`;
      await user.send({ embeds: [{ title: "✅ Pagamento concluído com sucesso", color: 0xffb800,
        description: description + extraLinks.map((link,i)=>`\n\n🎁 **Convite do amigo ${i+2}${order?.server_id==='both'?' • servidor Trio':''}:**\n${link}\nUso único, válido por 30 dias; login com Steam e Discord.`).join('') + (claimUrl ? `\n\n🎁 **Envie este link ao seu amigo${order?.server_id==='both'?' • Duo + Trio':''}:**\n${claimUrl}\nUm único resgate, válido por 30 dias após a compra. Ele deve entrar com Discord e Steam para receber ${order?.gift?'o presente':'Bronze + Prata + Ouro'}.` : ""),
        footer: { text: "Guerra Fria • Loja VIP" } }], allowedMentions: { parse: [] } });
      await pool.query("UPDATE store_receipts SET sent_at=now(),lease_until=NULL WHERE payment_id=$1", [payment.id]);
    } catch {
      // Closed DMs never undo delivery. Retry later without logging the private claim URL.
      await pool.query("UPDATE store_receipts SET lease_until=NULL,next_attempt_at=now()+interval '15 minutes' WHERE payment_id=$1", [receipt.payment_id]);
      logger.warn({ paymentId: receipt.payment_id }, "Private purchase receipt will retry");
    }
  }
}
export function startStoreReceipts(): void {
  let running = false;
  const scan = async () => {
    if (running) return; running = true;
    try { await sendStoreReceipts(); } catch { logger.warn("Store receipt scan will retry"); }
    finally { running = false; }
  };
  const timer = setInterval(scan, 10_000); timer.unref();
}
