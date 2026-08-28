import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const GENERAL_THRESHOLD = 1700;
const RANKS = [
  { name:"Recruta", short:"RCT", level:1, min:0, is_general:false },
  { name:"Soldado", short:"SLD", level:2, min:1100, is_general:false },
  { name:"Capitão", short:"CAP", level:3, min:1250, is_general:false },
  { name:"Coronel", short:"CEL", level:4, min:1450, is_general:false },
  { name:"General de Guerra", short:"GEN", level:5, min:1700, is_general:true },
];
const n=(v:unknown,f=0)=>Number.isFinite(Number(v))?Number(v):f;
const i=(v:unknown,f=0)=>Math.trunc(n(v,f));
const s=(v:unknown,max=1000)=>String(v??"").slice(0,max);
function rankFor(v:unknown){const mmr=n(v,1000);return mmr>=1700?RANKS[4]:mmr>=1450?RANKS[3]:mmr>=1250?RANKS[2]:mmr>=1100?RANKS[1]:RANKS[0]}
function actions(row:any){const a:string[]=[];if(i(row.kills)>0)a.push("Eliminações PvP");if(i(row.headshots)>0)a.push("Headshots");if(i(row.assists)>0)a.push("Assistências");if(i(row.raids_participated)>0)a.push("Participação em raids");if(i(row.raids_defended)>0)a.push("Defesa de raids");if(i(row.wood)>0||i(row.stone)>0||i(row.metal_ore)>0||i(row.sulfur_ore)>0||i(row.hqm_ore)>0)a.push("Farm");if(i(row.bradley_participations)>0)a.push("Bradley APC");if(i(row.heli_participations)>0)a.push("Helicóptero de Patrulha");if(i(row.crates_hacked)>0)a.push("Caixas hackeadas");return a}
function publicPlayer(row:any,position?:number){const mmr=n(row.effective_mmr,row.mmr);const rank=rankFor(mmr);const out:any={position:position??i(row.position),steam_id:s(row.steam_id,32),player_name:s(row.player_name,128),patente:rank.name,patente_codigo:rank.short,patente_nivel:rank.level,patente_maxima:rank.is_general,kills:i(row.kills),deaths:i(row.deaths),headshots:i(row.headshots),assists:i(row.assists),raids_participated:i(row.raids_participated),raids_defended:i(row.raids_defended),bradley_participations:i(row.bradley_participations),heli_participations:i(row.heli_participations),crates_hacked:i(row.crates_hacked),actions:actions(row),updated_at:row.updated_at};if(rank.is_general)out.general_score=Math.round(mmr*100)/100;return out}

router.get("/season/:number", async(req,res,next)=>{
  if(!/^\d+$/.test(String(req.params.number||"")))return next();
  try{
    const seasonNumber=Math.max(1,i(req.params.number,1));
    const limit=Math.min(300,Math.max(10,i(req.query.limit,100)));
    const seasonResult:any=await db.execute(sql`SELECT season_number,season_id,status,started_at,ended_at,updated_at FROM seasons WHERE season_number=${seasonNumber} LIMIT 1`);
    const rankingResult:any=await db.execute(sql`
      WITH admin_delta AS (
        SELECT steam_id, COALESCE(SUM(final_value),0) AS delta
        FROM season_transactions
        WHERE season_number=${seasonNumber} AND category='admin'
        GROUP BY steam_id
      )
      SELECT p.*, COALESCE(a.delta,0) AS admin_delta, p.mmr+COALESCE(a.delta,0) AS effective_mmr,
             ROW_NUMBER() OVER (ORDER BY p.mmr+COALESCE(a.delta,0) DESC,p.kills DESC,p.updated_at ASC) AS position
      FROM season_players p LEFT JOIN admin_delta a ON a.steam_id=p.steam_id
      WHERE p.season_number=${seasonNumber}
      ORDER BY effective_mmr DESC,p.kills DESC,p.updated_at ASC LIMIT ${limit}`);
    const rows=(rankingResult?.rows??[]) as any[];
    const ranking=rows.map((r,idx)=>publicPlayer(r,idx+1));
    res.setHeader("Cache-Control","public, max-age=5, stale-while-revalidate=10");
    return void res.json({ok:true,season_number:seasonNumber,season:seasonResult?.rows?.[0]??null,methodology:{metric:"MMR",public_mmr:false,description:"As patentes usam o MMR interno da Season, incluindo ajustes administrativos auditáveis. O MMR individual permanece oculto."},ranks:RANKS,general_count:ranking.filter((p:any)=>p.patente_maxima).length,ranking});
  }catch(error){logger.error({error},"adjusted season ranking failed");return void res.status(500).json({error:"Falha ao carregar ranking da Season."})}
});

router.get("/season/:number/player/:steamId",async(req,res,next)=>{
  const steamId=s(req.params.steamId,32);if(!/^7656119\d{10}$/.test(steamId))return next();
  try{
    const seasonNumber=Math.max(1,i(req.params.number,1));
    const playerResult:any=await db.execute(sql`
      WITH admin_delta AS (SELECT steam_id,COALESCE(SUM(final_value),0) delta FROM season_transactions WHERE season_number=${seasonNumber} AND category='admin' GROUP BY steam_id), ranked AS (
        SELECT p.*,COALESCE(a.delta,0) admin_delta,p.mmr+COALESCE(a.delta,0) effective_mmr,
        ROW_NUMBER() OVER(ORDER BY p.mmr+COALESCE(a.delta,0) DESC,p.kills DESC,p.updated_at ASC) position
        FROM season_players p LEFT JOIN admin_delta a ON a.steam_id=p.steam_id WHERE p.season_number=${seasonNumber})
      SELECT * FROM ranked WHERE steam_id=${steamId} LIMIT 1`);
    const tx:any=await db.execute(sql`SELECT category,event_type,CASE WHEN final_value>0 THEN 'gain' WHEN final_value<0 THEN 'loss' ELSE 'neutral' END direction,details,happened_at FROM season_transactions WHERE season_number=${seasonNumber} AND steam_id=${steamId} ORDER BY happened_at DESC LIMIT 100`);
    return void res.json({ok:true,player:playerResult?.rows?.[0]?publicPlayer(playerResult.rows[0]):null,transactions:tx?.rows??[]});
  }catch(error){logger.error({error},"adjusted season player failed");return void res.status(500).json({error:"Falha ao carregar jogador da Season."})}
});

export default router;
