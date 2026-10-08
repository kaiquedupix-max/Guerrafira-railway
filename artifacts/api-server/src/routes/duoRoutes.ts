import { Router } from "express";
import { getCommunitySession } from "../admin/communitySession.js";
import { getLinkedSteamV2 } from "../bot/utils/linkedSteamV2.js";
import { inspectDuoToken, redeemDuo } from "./duoService.js";
import { officialSteam } from "./storeSteamAuth.js";
import { renderDuoPage } from "../admin/duoPage.js";
import { logger } from "../lib/logger.js";
const router = Router();
router.use((_req, res, next) => { res.setHeader("Referrer-Policy", "no-referrer"); next(); });
router.get("/redeem", (_req, res) => res.type("html").send(renderDuoPage()));
router.post("/inspect", async (req, res) => {
  try {
    const row = await inspectDuoToken(String(req.body?.token || ""));
    return res.json({ status: row.status === "available" && new Date(row.expires_at).getTime() <= Date.now() ? "expired" : row.status,
      expiresAt: row.expires_at, slot: row.slot });
  } catch { return res.status(404).json({ error: "Link inválido ou pagamento indisponível." }); }
});
router.post("/claim", async (req, res) => {
  if (req.get("origin") !== "https://www.guerrafriarust.com.br") return res.status(403).json({ error: "Origem inválida." });
  const session = getCommunitySession(req);
  if (!session) return res.status(401).json({ error: "Entre com Discord antes de resgatar." });
  const linked = await getLinkedSteamV2(session.userId);
  if (!linked?.steamId || !(await officialSteam(session.userId, linked.steamId))) return res.status(409).json({ error: "Autentique sua Steam pelo botão oficial." });
  try {
    await redeemDuo(String(req.body?.token || ""), session.userId, linked.steamId);
    return res.json({ status: "redeemed" });
  } catch (error) {
    logger.error({ error, discordUserId: session.userId }, "Super Combo claim failed");
    const message = error instanceof Error ? error.message : "Entrega pendente. Tente novamente em instantes.";
    // Never include token or provider responses in feedback.
    const safe = ["comprador", "outro duo", "já foi resgatado", "já resgatou uma vaga", "expirou", "inválido", "não aprovado", "indisponível"].some(word => message.includes(word));
    return res.status(409).json({ error: safe ? message : "Entrega em processamento. A vaga fica vinculada à sua conta e será tentada novamente automaticamente." });
  }
});
export default router;
