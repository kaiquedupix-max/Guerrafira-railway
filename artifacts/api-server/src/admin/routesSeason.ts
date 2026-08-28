import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "./guard.js";
import { getAdminSessionV3 } from "./sessionBearer.js";

const router = Router();
router.use(requireAdmin);

async function ensureRegistrationTable() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_registrations (
    season_number INTEGER NOT NULL, discord_id TEXT NOT NULL, discord_name TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'beta_free', status TEXT NOT NULL DEFAULT 'active',
    accepted_rules_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (season_number, discord_id))`);
  await db.execute(sql`ALTER TABLE season_registrations ADD COLUMN IF NOT EXISTS steam_id TEXT`);
}

function rankName(mmrValue: unknown) {
  const mmr = Number(mmrValue ?? 1000);
  if (mmr >= 1700) return "General de Guerra";
  if (mmr >= 1450) return "Coronel";
  if (mmr >= 1250) return "Capitão";
  if (mmr >= 1100) return "Soldado";
  return "Recruta";
}
const validSteam=(v:unknown)=>/^7656119\d{10}$/.test(String(v||""));

router.get("/registrations", async (req, res) => {
  try {
    await ensureRegistrationTable();
    const season = Math.max(1, Math.trunc(Number(req.query.season) || 1));
    const result: any = await db.execute(sql`
      WITH admin_delta AS (
        SELECT steam_id,COALESCE(SUM(final_value),0) delta FROM season_transactions
        WHERE season_number=${season} AND category='admin' GROUP BY steam_id
      )
      SELECT r.season_number,r.discord_id,r.discord_name,r.mode,r.status,r.accepted_rules_at,r.created_at,
        COALESCE(r.steam_id,b.steam_id) steam_id,p.player_name,p.mmr raw_mmr,
        CASE WHEN p.mmr IS NULL THEN NULL ELSE p.mmr+COALESCE(a.delta,0) END mmr,
        COALESCE(a.delta,0) admin_delta,p.kills,p.deaths,p.headshots,p.raids_participated,p.raids_defended,
        p.bradley_participations,p.heli_participations,p.crates_hacked,p.updated_at
      FROM season_registrations r
      LEFT JOIN booster_links b ON b.discord_user_id=r.discord_id
      LEFT JOIN season_players p ON p.season_number=r.season_number AND p.steam_id=COALESCE(r.steam_id,b.steam_id)
      LEFT JOIN admin_delta a ON a.steam_id=COALESCE(r.steam_id,b.steam_id)
      WHERE r.season_number=${season} AND r.status='active'
      ORDER BY mmr DESC NULLS LAST,r.created_at ASC`);
    const rows=Array.isArray(result?.rows)?result.rows:[];
    let position=0;
    const registrations=rows.map((row:any)=>{
      const has=row.mmr!=null;if(has)position++;
      return {position:has?position:null,discordId:String(row.discord_id||""),discordName:String(row.discord_name||""),steamId:row.steam_id?String(row.steam_id):null,playerName:row.player_name?String(row.player_name):null,mode:String(row.mode||"beta_free"),status:String(row.status||"active"),acceptedRulesAt:row.accepted_rules_at,createdAt:row.created_at,mmr:row.mmr==null?null:Number(row.mmr),rawMmr:row.raw_mmr==null?null:Number(row.raw_mmr),adminDelta:Number(row.admin_delta||0),rank:row.mmr==null?"Aguardando dados":rankName(row.mmr),kills:Number(row.kills||0),deaths:Number(row.deaths||0),headshots:Number(row.headshots||0),raids:Number(row.raids_participated||0)+Number(row.raids_defended||0),events:Number(row.bradley_participations||0)+Number(row.heli_participations||0)+Number(row.crates_hacked||0),updatedAt:row.updated_at,testerRole:true};
    });
    const ranked=registrations.filter((x:any)=>x.mmr!=null);
    res.setHeader("Cache-Control","no-store");
    return void res.json({ok:true,beta:season===1,season,roleId:process.env.SEASON_BETA_ROLE_ID||null,summary:{total:registrations.length,linkedSteam:registrations.filter((x:any)=>x.steamId).length,withSeasonData:ranked.length,leader:ranked[0]||null},registrations});
  } catch (error) {
    req.log?.error?.({ error }, "admin season registrations failed");
    return void res.status(500).json({ error: "Falha ao carregar inscritos da Season." });
  }
});

router.get("/player/:steamId/history", async(req,res)=>{
  const steamId=String(req.params.steamId||"");
  const season=Math.max(1,Math.trunc(Number(req.query.season)||1));
  if(!validSteam(steamId))return void res.status(400).json({error:"SteamID inválido."});
  try{
    const player:any=await db.execute(sql`
      SELECT p.*,COALESCE((SELECT SUM(final_value) FROM season_transactions t WHERE t.season_number=${season} AND t.steam_id=${steamId} AND t.category='admin'),0) admin_delta
      FROM season_players p WHERE p.season_number=${season} AND p.steam_id=${steamId} LIMIT 1`);
    const row=player?.rows?.[0]||null;
    const tx:any=await db.execute(sql`
      SELECT transaction_id,category,event_type,base_value,multiplier,final_value,resulting_mmr,details,happened_at,received_at
      FROM season_transactions WHERE season_number=${season} AND steam_id=${steamId}
      ORDER BY happened_at DESC,received_at DESC LIMIT 300`);
    return void res.json({ok:true,player:row?{steamId,playerName:row.player_name,rawMmr:Number(row.mmr||0),adminDelta:Number(row.admin_delta||0),mmr:Number(row.mmr||0)+Number(row.admin_delta||0),rank:rankName(Number(row.mmr||0)+Number(row.admin_delta||0))}:null,transactions:tx?.rows??[]});
  }catch(error){req.log?.error?.({error},"season history failed");return void res.status(500).json({error:"Falha ao carregar histórico de MMR."})}
});

router.post("/player/:steamId/adjust",async(req,res)=>{
  const steamId=String(req.params.steamId||"");const season=Math.max(1,Math.trunc(Number(req.body?.season)||1));
  const delta=Number(req.body?.delta);const reason=String(req.body?.reason||"").trim().slice(0,500);
  if(!validSteam(steamId))return void res.status(400).json({error:"SteamID inválido."});
  if(!Number.isFinite(delta)||delta===0||Math.abs(delta)>5000)return void res.status(400).json({error:"Informe um ajuste entre -5000 e +5000 MMR."});
  if(reason.length<3)return void res.status(400).json({error:"Informe o motivo do ajuste."});
  try{
    const p:any=await db.execute(sql`SELECT player_name,mmr,season_id FROM season_players WHERE season_number=${season} AND steam_id=${steamId} LIMIT 1`);
    const row=p?.rows?.[0];if(!row)return void res.status(404).json({error:"Jogador não possui dados nesta Season."});
    const d:any=await db.execute(sql`SELECT COALESCE(SUM(final_value),0) delta FROM season_transactions WHERE season_number=${season} AND steam_id=${steamId} AND category='admin'`);
    const before=Number(row.mmr||0)+Number(d?.rows?.[0]?.delta||0);const after=before+delta;
    const admin=getAdminSessionV3(req);const adminName=admin?.username||"Administrador";
    const id=`admin-${randomUUID()}`;
    await db.execute(sql`INSERT INTO season_transactions(transaction_id,season_number,season_id,steam_id,player_name,category,event_type,base_value,multiplier,final_value,resulting_mmr,details,happened_at)
      VALUES(${id},${season},${String(row.season_id||`season-${season}`)},${steamId},${String(row.player_name||steamId)},'admin','admin_adjustment',${delta},1,${delta},${after},${`Ajuste manual por ${adminName}: ${reason}`},now())`);
    return void res.json({ok:true,steamId,delta,before,after,admin:adminName,reason});
  }catch(error){req.log?.error?.({error},"season admin adjustment failed");return void res.status(500).json({error:"Falha ao aplicar ajuste de MMR."})}
});

router.post("/player/:steamId/reverse",async(req,res)=>{
  const steamId=String(req.params.steamId||"");const season=Math.max(1,Math.trunc(Number(req.body?.season)||1));
  const transactionId=String(req.body?.transactionId||"").trim();const reason=String(req.body?.reason||"").trim().slice(0,500);
  if(!validSteam(steamId)||!transactionId)return void res.status(400).json({error:"Dados inválidos."});
  if(reason.length<3)return void res.status(400).json({error:"Informe o motivo do estorno."});
  try{
    const original:any=await db.execute(sql`SELECT transaction_id,season_id,player_name,final_value,event_type FROM season_transactions WHERE transaction_id=${transactionId} AND season_number=${season} AND steam_id=${steamId} LIMIT 1`);
    const tx=original?.rows?.[0];if(!tx)return void res.status(404).json({error:"Lançamento não encontrado."});
    const value=Number(tx.final_value||0);if(!value)return void res.status(409).json({error:"Este lançamento não possui MMR para estornar."});
    const marker=`reversal_of=${transactionId}`;
    const exists:any=await db.execute(sql`SELECT transaction_id FROM season_transactions WHERE season_number=${season} AND steam_id=${steamId} AND category='admin' AND details LIKE ${`%${marker}%`} LIMIT 1`);
    if(exists?.rows?.[0])return void res.status(409).json({error:"Este lançamento já foi estornado."});
    const p:any=await db.execute(sql`SELECT mmr FROM season_players WHERE season_number=${season} AND steam_id=${steamId} LIMIT 1`);
    const d:any=await db.execute(sql`SELECT COALESCE(SUM(final_value),0) delta FROM season_transactions WHERE season_number=${season} AND steam_id=${steamId} AND category='admin'`);
    const before=Number(p?.rows?.[0]?.mmr||0)+Number(d?.rows?.[0]?.delta||0);const delta=-value;const after=before+delta;
    const admin=getAdminSessionV3(req);const adminName=admin?.username||"Administrador";const id=`admin-${randomUUID()}`;
    await db.execute(sql`INSERT INTO season_transactions(transaction_id,season_number,season_id,steam_id,player_name,category,event_type,base_value,multiplier,final_value,resulting_mmr,details,happened_at)
      VALUES(${id},${season},${String(tx.season_id||`season-${season}`)},${steamId},${String(tx.player_name||steamId)},'admin','admin_reversal',${delta},1,${delta},${after},${`${marker}; por ${adminName}; motivo: ${reason}; evento_original=${String(tx.event_type||"")}`},now())`);
    return void res.json({ok:true,delta,before,after,reversed:transactionId});
  }catch(error){req.log?.error?.({error},"season reverse failed");return void res.status(500).json({error:"Falha ao estornar pontuação."})}
});

export default router;
