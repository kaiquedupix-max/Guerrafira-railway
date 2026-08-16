import { Router } from "express";
import { requireAdmin } from "./guard.js";
import { auditWipe, buildWipePlan, diagnoseHost, executeWipe, type WipeKind } from "../core/hostWipe.js";

const router = Router(); router.use(requireAdmin);
const kindOf = (value: unknown): WipeKind => value === "full" ? "full" : value === "map_players" ? "map_players" : "map";

router.get("/wipe/diagnostic", async (req,res) => {
  try { const data = await diagnoseHost(); await auditWipe("WIPE_DIAGNOSTIC", { id:res.locals.admin.userId,name:res.locals.admin.username }, "Diagnóstico somente leitura executado pelo painel."); res.json(data); }
  catch(error:any){res.status(502).json({error:error?.message||"Falha no diagnóstico."})}
});
router.get("/wipe/plan", async (req,res) => {
  try { const plan=await buildWipePlan(kindOf(req.query.kind)); await auditWipe("WIPE_PLAN", {id:res.locals.admin.userId,name:res.locals.admin.username}, `${plan.kind}: ${plan.files.length} arquivos, nenhuma alteração.`); res.json(plan); }
  catch(error:any){res.status(502).json({error:error?.message||"Falha ao planejar wipe."})}
});
router.post("/wipe/execute", async (req,res) => {
  try { await executeWipe(kindOf(req.body?.kind),String(req.body?.confirmation||""),{id:res.locals.admin.userId,name:res.locals.admin.username}); }
  catch(error:any){return void res.status(423).json({error:error?.message||"Wipe bloqueado."})}
});
export default router;
