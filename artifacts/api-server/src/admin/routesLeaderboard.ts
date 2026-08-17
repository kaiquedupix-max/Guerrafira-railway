import { Router } from "express";
import { requireAdmin } from "./guard.js";
import { resetAllLeaderboardStats } from "../core/leaderboardReset.js";

const router = Router();
router.use(requireAdmin);
router.post("/reset", async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ error: "Confirmação obrigatória." });
  // Preserva os jogadores e zera somente os contadores, como no Discord e nos wipes.
  await resetAllLeaderboardStats();
  res.json({ ok: true });
});
export default router;
