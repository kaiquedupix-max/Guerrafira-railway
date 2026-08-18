import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ingestLeaderboardPayload } from "../bot/killTracker.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
let initialized=false;

function authorized(value:unknown):boolean{
  const expected=String(process.env.LEADERBOARD_WEBHOOK_SECRET||"").trim(),received=String(value||"").trim();
  if(!expected||!received)return false;
  const a=Buffer.from(expected),b=Buffer.from(received);
  return a.length===b.length&&timingSafeEqual(a,b);
}

async function initializeReceipts(){
  if(initialized)return;
  await db.execute(sql`CREATE TABLE IF NOT EXISTS leaderboard_event_receipts (event_id text PRIMARY KEY, received_at timestamp NOT NULL DEFAULT now())`);
  initialized=true;
}

router.post("/leaderboard/events",async(req,res)=>{
  if(!process.env.LEADERBOARD_WEBHOOK_SECRET?.trim())return void res.status(503).json({error:"LEADERBOARD_WEBHOOK_SECRET não configurada."});
  if(!authorized(req.header("x-gf-leaderboard-secret")))return void res.status(401).json({error:"Assinatura do leaderboard inválida."});
  const events=Array.isArray(req.body?.events)?req.body.events.slice(0,250):[];
  if(!events.length)return void res.status(400).json({error:"Nenhum evento recebido."});
  try{
    await initializeReceipts();let accepted=0,duplicates=0,rejected=0;
    for(const raw of events){
      if(!raw||typeof raw!=="object"){rejected++;continue}
      const eventId=String(raw.event_id||"").toLowerCase();
      if(!/^[a-f0-9-]{16,64}$/.test(eventId)){rejected++;continue}
      const receipt:any=await db.execute(sql`INSERT INTO leaderboard_event_receipts (event_id) VALUES (${eventId}) ON CONFLICT DO NOTHING RETURNING event_id`);
      const inserted=Array.isArray(receipt?.rows)?receipt.rows.length>0:Array.isArray(receipt)?receipt.length>0:Number(receipt?.rowCount||0)>0;
      if(!inserted){duplicates++;continue}
      try{if(await ingestLeaderboardPayload(raw as Record<string,unknown>))accepted++;else rejected++}
      catch(error){await db.execute(sql`DELETE FROM leaderboard_event_receipts WHERE event_id=${eventId}`).catch(()=>{});throw error}
    }
    res.json({ok:true,accepted,duplicates,rejected});
  }catch(error){logger.error({error},"leaderboard webhook ingestion failed");res.status(500).json({error:"Falha ao gravar eventos do leaderboard."})}
});

export default router;
