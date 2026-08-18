import { Router } from "express";
import { requireAdmin } from "./guard.js";
import { auditWipe, buildWipePlan, diagnoseHost, executeProceduralWipe, type WipeKind } from "../core/hostWipe.js";
import { createMapVote, type MapImageUpload } from "../bot/commands/criarmapa.js";
import { discordClient } from "../bot/client.js";
import { db, mapVotesTable, mapVoteBallotsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { getWipeLockState, setWipeLock } from "../core/wipeLock.js";

const router = Router(); router.use(requireAdmin);
const kindOf = (value: unknown): WipeKind => value === "general" ? "general" : "map";
router.get("/wipe/lock",async(_req,res)=>{try{res.json(await getWipeLockState())}catch(error:any){res.status(500).json({error:error?.message||"Falha ao consultar trava."})}});
router.post("/wipe/lock",async(req,res)=>{try{if(typeof req.body?.unlocked!=="boolean")return void res.status(400).json({error:"Estado inválido."});const actor={id:res.locals.admin.userId,name:res.locals.admin.username};const state=await setWipeLock(req.body.unlocked,`${actor.name} (${actor.id})`);await auditWipe(state.unlocked?"WIPE_UNLOCKED":"WIPE_LOCKED",actor,`Trava alterada pelo painel: ${state.unlocked?"liberado":"travado"}.`);res.json(state)}catch(error:any){res.status(500).json({error:error?.message||"Falha ao alterar trava."})}});

router.get("/wipe/diagnostic", async (req,res) => {
  try { const data = await diagnoseHost(); await auditWipe("WIPE_DIAGNOSTIC", { id:res.locals.admin.userId,name:res.locals.admin.username }, "Diagnóstico somente leitura executado pelo painel."); res.json(data); }
  catch(error:any){res.status(502).json({error:error?.message||"Falha no diagnóstico."})}
});
router.get("/wipe/plan", async (req,res) => {
  try { const seed=Number(req.query.seed),size=Number(req.query.size);if(!Number.isInteger(seed)||seed<0||seed>2147483647)throw new Error("Seed inválida.");if(!Number.isInteger(size)||size<1000||size>6000)throw new Error("Size deve estar entre 1000 e 6000.");const plan=await buildWipePlan(kindOf(req.query.kind)); await auditWipe("WIPE_PLAN", {id:res.locals.admin.userId,name:res.locals.admin.username}, `${plan.kind}: ${plan.files.length} arquivos; seed ${seed}; size ${size}; nenhuma alteração.`); res.json({...plan,seed,size}); }
  catch(error:any){res.status(502).json({error:error?.message||"Falha ao planejar wipe."})}
});
router.get("/wipe/status",async(_req,res)=>{
  try{const rows=await db.select().from(mapVotesTable).orderBy(desc(mapVotesTable.createdAt)).limit(10);const ballots=await db.select().from(mapVoteBallotsTable);res.json({serverNow:Date.now(),votes:rows.map(row=>{let maps:any[]=[];try{maps=JSON.parse(row.mapsJson)}catch{}const voteBallots=ballots.filter(b=>b.mapVoteId===row.id);const counts=maps.map((_m:any,index:number)=>voteBallots.filter(b=>b.optionIndex===index).reduce((sum,b)=>sum+b.weight,0));const max=Math.max(0,...counts);const leaders=counts.map((value,index)=>value===max&&max>0?index:-1).filter(index=>index>=0);return{id:row.id,status:row.status,endsAt:row.endsAt,wipeAt:row.wipeAt,winnerIndex:row.winnerIndex,leaderIndexes:leaders,counts,participants:voteBallots.length,appliedAt:row.appliedAt,failureReason:row.failureReason,messageId:row.messageId,channelId:row.channelId,maps:maps.map((m:any)=>({name:m.name,seed:m.seed,size:m.size,image:m.image}))}})});}catch(error:any){res.status(500).json({error:error?.message||"Falha ao consultar votações."})}
});
router.post("/wipe/vote",async(req,res)=>{
  try{const client=discordClient();if(!client)return void res.status(503).json({error:"Bot do Discord ainda não está conectado."});const date=String(req.body?.date||"").trim();const maps=[1,2,3].map(n=>({seed:Number(req.body?.[`seed${n}`]),size:Number(req.body?.[`size${n}`])}));const imageFiles=[req.body?.image1,req.body?.image2,req.body?.image3].map(v=>v&&typeof v==="object"?{name:String(v.name||"imagem"),mime:String(v.mime||""),data:String(v.data||"")} as MapImageUpload:undefined);const expectedWipeAt=Number(req.body?.expectedWipeAt);const result=await createMapVote(client,{createdBy:res.locals.admin.userId,date,maps,imageFiles,expectedWipeAt:Number.isFinite(expectedWipeAt)?expectedWipeAt:undefined});await auditWipe("MAP_VOTE_CREATED",{id:res.locals.admin.userId,name:res.locals.admin.username},`Votação ${result.id} criada pelo painel; wipe ${new Date(result.wipeAt).toISOString()}.`);res.status(201).json(result);}catch(error:any){res.status(409).json({error:error?.message||"Falha ao criar votação."})}
});
router.post("/wipe/execute", async (req,res) => {
  try { const result=await executeProceduralWipe(kindOf(req.body?.kind),Number(req.body?.seed),Number(req.body?.size),String(req.body?.confirmation||""),{id:res.locals.admin.userId,name:res.locals.admin.username}); res.json(result); }
  catch(error:any){return void res.status(423).json({error:error?.message||"Wipe bloqueado."})}
});
export default router;
