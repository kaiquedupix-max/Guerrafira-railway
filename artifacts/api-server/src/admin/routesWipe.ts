import { Router } from "express";
import { requireAdmin } from "./guard.js";
import { auditWipe, buildWipePlan, diagnoseHost, executeWipe, type WipeKind } from "../core/hostWipe.js";
import { createMapVote, nextScheduledWipe, type MapImageUpload } from "../bot/commands/criarmapa.js";
import { discordClient } from "../bot/client.js";
import { db, mapVotesTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router = Router(); router.use(requireAdmin);
const kindOf = (value: unknown): WipeKind => value === "general" ? "general" : "map";

router.get("/wipe/diagnostic", async (req,res) => {
  try { const data = await diagnoseHost(); await auditWipe("WIPE_DIAGNOSTIC", { id:res.locals.admin.userId,name:res.locals.admin.username }, "Diagnóstico somente leitura executado pelo painel."); res.json(data); }
  catch(error:any){res.status(502).json({error:error?.message||"Falha no diagnóstico."})}
});
router.get("/wipe/plan", async (req,res) => {
  try { const plan=await buildWipePlan(kindOf(req.query.kind), String(req.query.rustmaps || "")); await auditWipe("WIPE_PLAN", {id:res.locals.admin.userId,name:res.locals.admin.username}, `${plan.kind}: ${plan.files.length} arquivos, nenhuma alteração.`); res.json(plan); }
  catch(error:any){res.status(502).json({error:error?.message||"Falha ao planejar wipe."})}
});
router.get("/wipe/status",async(_req,res)=>{
  try{const rows=await db.select().from(mapVotesTable).orderBy(desc(mapVotesTable.createdAt)).limit(10);res.json({schedule:nextScheduledWipe(),serverNow:Date.now(),votes:rows.map(row=>{let maps:any[]=[];try{maps=JSON.parse(row.mapsJson)}catch{}return{id:row.id,status:row.status,endsAt:row.endsAt,wipeAt:row.wipeAt,winnerIndex:row.winnerIndex,appliedAt:row.appliedAt,failureReason:row.failureReason,messageId:row.messageId,channelId:row.channelId,maps:maps.map((m:any)=>({name:m.name,pageUrl:m.pageUrl,image:m.image}))}})});}catch(error:any){res.status(500).json({error:error?.message||"Falha ao consultar votações."})}
});
router.post("/wipe/vote",async(req,res)=>{
  try{const client=discordClient();if(!client)return void res.status(503).json({error:"Bot do Discord ainda não está conectado."});const links=[req.body?.link1,req.body?.link2,req.body?.link3].map(v=>String(v||"").trim());const imageFiles=[req.body?.image1,req.body?.image2,req.body?.image3].map(v=>v&&typeof v==="object"?{name:String(v.name||"imagem"),mime:String(v.mime||""),data:String(v.data||"")} as MapImageUpload:undefined);const expectedWipeAt=Number(req.body?.expectedWipeAt);const result=await createMapVote(client,{createdBy:res.locals.admin.userId,links,imageFiles,expectedWipeAt:Number.isFinite(expectedWipeAt)?expectedWipeAt:undefined});await auditWipe("MAP_VOTE_CREATED",{id:res.locals.admin.userId,name:res.locals.admin.username},`Votação ${result.id} criada pelo painel; wipe ${new Date(result.wipeAt).toISOString()}.`);res.status(201).json(result);}catch(error:any){res.status(409).json({error:error?.message||"Falha ao criar votação."})}
});
router.post("/wipe/execute", async (req,res) => {
  try { const result=await executeWipe(kindOf(req.body?.kind),String(req.body?.rustmaps||""),String(req.body?.confirmation||""),{id:res.locals.admin.userId,name:res.locals.admin.username}); res.json(result); }
  catch(error:any){return void res.status(423).json({error:error?.message||"Wipe bloqueado."})}
});
export default router;
