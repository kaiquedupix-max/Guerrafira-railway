import { Router } from "express";
import { db, playerStatsTable } from "@workspace/db";
import { requireAdmin } from "./guard.js";

const router = Router();
router.use(requireAdmin);
router.post("/reset", async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ error: "Confirmação obrigatória." });
  await db.delete(playerStatsTable);
  res.json({ ok: true });
});
export default router;
