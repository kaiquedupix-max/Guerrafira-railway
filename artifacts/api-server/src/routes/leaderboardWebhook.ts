import { authenticatedEventServer, EventSourceError } from "../core/eventSource.js";
import { withAdminServer } from "../core/adminServerContext.js";
import { ensureCompetitiveStore } from "../core/competitiveStore.js";
import { Router, type IRouter } from "express";
import { ingestUniqueLeaderboardEvent } from "../bot/killTracker.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.post("/leaderboard/events",async(req,res)=>{
  let server;try{server=authenticatedEventServer(req,"leaderboard");}catch(error){const e=error as EventSourceError;return void res.status(e.status||400).json({error:e.message});}
  await withAdminServer(server,async()=>{
  const events=Array.isArray(req.body?.events)?req.body.events.slice(0,250):[];
  if(!events.length)return void res.status(400).json({error:"Nenhum evento recebido."});
  try{
    await ensureCompetitiveStore();let accepted=0,duplicates=0,rejected=0;
    for(const raw of events){
     if(!raw||typeof raw!=="object"||(raw.server_id!==undefined&&raw.server_id!==server)){rejected++;continue;}
     const result=await ingestUniqueLeaderboardEvent(raw);
     if(result==="accepted")accepted++;else if(result==="duplicate")duplicates++;else rejected++;
    }
    res.json({ok:true,serverId:server,accepted,duplicates,rejected});
  }catch(error){logger.error({error},"leaderboard webhook ingestion failed");res.status(500).json({error:"Falha ao gravar eventos do leaderboard."})}
 });
});

export default router;
