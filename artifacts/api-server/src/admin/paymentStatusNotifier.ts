import { db, paymentsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { notifySubscribedAdmins } from "./adminNotifications.js";
import { logger } from "../lib/logger.js";

const seen = new Map<number, string>();
let started = false;
let bootstrapped = false;

function money(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : `R$ ${value}`;
}

async function scan(): Promise<void> {
  const rows = await db.select().from(paymentsTable).orderBy(desc(paymentsTable.updatedAt)).limit(150);
  if (!bootstrapped) {
    for (const row of rows) seen.set(row.id, row.status);
    bootstrapped = true;
    return;
  }

  for (const row of rows) {
    const previous = seen.get(row.id);
    const current = String(row.status || "pending").toLowerCase();
    seen.set(row.id, current);
    if (previous === current) continue;

    const relevant = ["approved", "rejected", "cancelled", "expired"].includes(current);
    if (!relevant) continue;

    const label = current === "approved" ? "APROVADO" : current === "rejected" ? "REJEITADO" : current === "expired" ? "EXPIRADO" : "CANCELADO";
    const emoji = current === "approved" ? "✅" : current === "expired" ? "⌛" : "❌";
    const severity = current === "approved" ? "success" as const : current === "expired" ? "warning" as const : "critical" as const;
    const method = row.method ? ` • ${row.method.toUpperCase()}` : "";
    const tier = row.vipTier ? `VIP ${row.vipTier.toUpperCase()}` : "Pagamento";

    await notifySubscribedAdmins({
      kind: "payment",
      title: `${emoji} Pagamento ${label}`,
      message: `${tier} • ${money(row.amount)}${method}\nStatus alterado para ${label}.${row.steamId ? `\nSteamID: ${row.steamId}` : ""}`,
      steamId: row.steamId || undefined,
      severity,
    });
  }
}

export function startPaymentStatusNotifier(): void {
  if (started) return;
  started = true;
  scan().catch(err => logger.warn({ err }, "Payment notification bootstrap failed"));
  setInterval(() => scan().catch(err => logger.warn({ err }, "Payment notification scan failed")), 8_000);
}
