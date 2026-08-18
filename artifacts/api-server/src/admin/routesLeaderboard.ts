import { Router } from "express";
import { requireAdmin } from "./guard.js";
import { resetAllLeaderboardStats } from "../core/leaderboardReset.js";

const router = Router();
router.use(requireAdmin);
router.post("/reset", async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ error: "Confirmação obrigatória." });
  // Mantém os jogadores cadastrados e apenas zera os contadores. É o mesmo
  // fluxo seguro usado pelo Discord e pelos wipes automáticos.
  await resetAllLeaderboardStats();
  res.json({ ok: true });
});
export default router;
