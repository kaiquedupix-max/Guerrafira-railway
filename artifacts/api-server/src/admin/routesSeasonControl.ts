import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "./guard.js";
import { getAdminSessionV3 } from "./sessionBearer.js";
import { executeRconCommand } from "../bot/utils/rcon.js";
import { getSeasonControl, markSeasonReset, setSeasonScoringBlocked } from "../routes/seasonControl.js";
import { createSeasonBackup, getSeasonBackupStatus, restoreSeasonBackup } from "../routes/seasonBackup.js";
import { scoringSeasonForTime, syncSeason2LifecycleOnce } from "../routes/season2Lifecycle.js";

const router = Router();
router.use(requireAdmin);
const CURRENT_SEASON = 2;
const CURRENT_SEASON_KEY = 102;
const adminName = (req: any) => getAdminSessionV3(req)?.username || "Administrador";

async function logAction(admin: string, action: string, details: string) {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_admin_actions (id BIGSERIAL PRIMARY KEY,season_key INTEGER NOT NULL,admin_name TEXT NOT NULL,action TEXT NOT NULL,discord_id TEXT,details TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await db.execute(sql`INSERT INTO season_admin_actions(season_key,admin_name,action,details) VALUES(${CURRENT_SEASON_KEY},${admin},${action},${details})`);
}

router.get("/control", async (_req, res) => {
  try {
    const control:any=await getSeasonControl(CURRENT_SEASON);
    res.setHeader("Cache-Control","no-store");
    return void res.json({ok:true,season:CURRENT_SEASON,scoringBlocked:Boolean(control.scoring_blocked),changedAt:control.changed_at||null,changedBy:control.changed_by||null,lastResetAt:control.last_reset_at||null,lastResetBy:control.last_reset_by||null});
  } catch {
    return void res.status(500).json({ok:false,error:"Falha ao carregar controle da Season 2."});
  }
});

router.get("/control/backup", async (_req,res)=>{
  try{
    const backup=await getSeasonBackupStatus();
    res.setHeader("Cache-Control","no-store");
    return void res.json({ok:true,backup,intervalMinutes:60,singleSlot:true,currentSeason:CURRENT_SEASON,restorable:!backup||Number(backup.season_number)===CURRENT_SEASON});
  } catch(error){
    return void res.status(500).json({ok:false,error:error instanceof Error?error.message:"Falha ao carregar backup da Season 2."});
  }
});

router.post("/control/backup", async (req,res)=>{
  try{
    const admin=adminName(req);
    const backup=await createSeasonBackup(`manual:${admin}`,CURRENT_SEASON);
    await logAction(admin,"season_backup_created","Backup manual da Season 2 criado e substituiu o backup anterior.").catch(()=>{});
    return void res.json({ok:true,backup,message:"Backup da Season 2 atualizado com sucesso."});
  } catch(error){
    return void res.status(500).json({ok:false,error:error instanceof Error?error.message:"Falha ao criar backup da Season 2."});
  }
});

router.post("/control/backup/restore",async(req,res)=>{
  if(String(req.body?.confirm||"").trim().toUpperCase()!=="RESTAURAR")return void res.status(400).json({ok:false,error:"Confirmação inválida. Digite RESTAURAR."});
  const admin=adminName(req);
  try{
    const restored=await restoreSeasonBackup(admin,CURRENT_SEASON);
    await logAction(admin,"season_backup_restored",`Backup da Season 2 restaurado: ${restored.backupAt}; ${restored.players} jogadores; ${restored.transactions} transações.`).catch(()=>{});
    return void res.json({ok:true,restored,scoringBlocked:true,message:"Backup da Season 2 restaurado e verificado. A pontuação ficou BLOQUEADA por segurança."});
  } catch(error){
    req.log?.error?.({error},"season 2 backup restore failed");
    return void res.status(500).json({ok:false,scoringBlocked:true,error:error instanceof Error?error.message:"Falha ao restaurar backup da Season 2."});
  }
});

router.post("/control/block",async(req,res)=>{
  try{
    const admin=adminName(req);
    await setSeasonScoringBlocked(CURRENT_SEASON,true,admin);
    await logAction(admin,"scoring_blocked","Pontuação da Season 2 bloqueada manualmente.");
    return void res.json({ok:true,scoringBlocked:true,message:"Pontuação da Season 2 bloqueada."});
  }catch{
    return void res.status(500).json({ok:false,error:"Falha ao bloquear pontuação da Season 2."});
  }
});

router.post("/control/start",async(req,res)=>{
  try{
    const admin=adminName(req);
    await setSeasonScoringBlocked(CURRENT_SEASON,false,admin);
    await logAction(admin,"scoring_started","Pontuação da Season 2 liberada manualmente.");
    const live=scoringSeasonForTime()===CURRENT_SEASON;
    return void res.json({ok:true,scoringBlocked:false,live,message:live?"Pontuação da Season 2 liberada.":"Controle liberado; a pontuação só começa automaticamente em 02/10/2026 às 18:30."});
  }catch{
    return void res.status(500).json({ok:false,error:"Falha ao liberar pontuação da Season 2."});
  }
});

router.post("/control/reset", async (req,res)=>{
  const confirm=String(req.body?.confirm||"").trim().toUpperCase();
  if(confirm!=="ZERAR")return void res.status(400).json({ok:false,error:"Confirmação inválida. Digite ZERAR."});
  await syncSeason2LifecycleOnce();
  if(scoringSeasonForTime()!==CURRENT_SEASON){
    return void res.status(409).json({ok:false,error:"O reset competitivo da Season 2 só é permitido durante a janela oficial da Season 2. A Season 1 permanece protegida."});
  }
  const admin=adminName(req);
  const seasonId=`season-2-reset-${Date.now()}`;
  try{
    await setSeasonScoringBlocked(CURRENT_SEASON,true,admin);
    await db.transaction(async tx=>{
      await tx.execute(sql`DELETE FROM season_transactions WHERE season_number=${CURRENT_SEASON}`);
      await tx.execute(sql`DELETE FROM season_players WHERE season_number=${CURRENT_SEASON}`);
      await tx.execute(sql`DELETE FROM seasons WHERE season_number=${CURRENT_SEASON}`);
      await tx.execute(sql`INSERT INTO seasons (season_number,season_id,status,starting_mmr,started_at,ended_at,updated_at) VALUES (${CURRENT_SEASON},${seasonId},'active',1000,now(),NULL,now())`);
    });
    const verification:any=await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM season_players WHERE season_number=${CURRENT_SEASON}) AS players,
        (SELECT COUNT(*)::int FROM season_transactions WHERE season_number=${CURRENT_SEASON}) AS transactions,
        (SELECT season_id FROM seasons WHERE season_number=${CURRENT_SEASON} LIMIT 1) AS season_id,
        (SELECT COUNT(*)::int FROM seasons WHERE season_number=1) AS season1_rows
    `);
    const row=verification?.rows?.[0]||{};
    const playersRemaining=Number(row.players??-1);
    const transactionsRemaining=Number(row.transactions??-1);
    const verifiedSeasonId=String(row.season_id||"");
    const season1Rows=Number(row.season1_rows??0);
    if(playersRemaining!==0||transactionsRemaining!==0||verifiedSeasonId!==seasonId||season1Rows<1){
      throw new Error(`Verificação do reset falhou: ${playersRemaining} jogadores / ${transactionsRemaining} transações / histórico S1=${season1Rows}.`);
    }
    await markSeasonReset(CURRENT_SEASON,admin).catch(error=>req.log?.warn?.({error},"season 2 reset marker failed"));
    await logAction(admin,"season_score_reset",`Pontuação e histórico da Season 2 zerados; Season 1 e inscrições preservadas; id ${seasonId}.`).catch(error=>req.log?.warn?.({error},"season 2 reset audit log failed"));
    let pluginResetConfirmed=false;
    let rconWarning:string|null=null;
    try{
      const rcon=await executeRconCommand(`season.forcenew ${seasonId}`);
      pluginResetConfirmed=rcon!=null;
      if(!pluginResetConfirmed)rconWarning="RCON não confirmou o reset do plugin.";
    }catch(error){
      rconWarning=error instanceof Error?error.message:"RCON não confirmou o reset do plugin.";
      req.log?.warn?.({error},"season 2 plugin reset failed");
    }
    const message=pluginResetConfirmed
      ?"Season 2 zerada com segurança. O histórico da Season 1 foi preservado e a pontuação da S2 ficou BLOQUEADA até liberação manual."
      :"Season 2 zerada no banco. O histórico da Season 1 foi preservado; como o RCON não confirmou o plugin, a pontuação ficou BLOQUEADA.";
    res.setHeader("Cache-Control","no-store");
    return void res.json({ok:true,scoringBlocked:true,seasonId,pluginResetConfirmed,rconWarning,playersRemaining,transactionsRemaining,season1Rows,message});
  }catch(error){
    req.log?.error?.({error},"season 2 manual reset failed");
    return void res.status(500).json({ok:false,scoringBlocked:true,error:error instanceof Error?`Falha ao zerar a Season 2: ${error.message}`:"Falha ao zerar a Season 2. A pontuação permaneceu bloqueada."});
  }
});

export default router;
