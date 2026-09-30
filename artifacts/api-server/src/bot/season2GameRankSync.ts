import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { rankForSeason, ranksForSeason, xpFromMmr } from "../routes/seasonRanks.js";
import { executeRconCommand } from "./utils/rcon.js";

const SEASON=2;
const OFFICIAL_KEY=102;
const STARTING_MMR=1000;
const GROUPS=ranksForSeason(SEASON).map(rank=>rank.group);
const LEGACY_GROUPS=["season_recruta","season_soldado","season_tenente","season_major","season_marechal","season_generalfrio"];
let timer:NodeJS.Timeout|null=null;
let running=false;
let groupsEnsured=false;

async function ensureStateTable(){
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS season_game_rank_state (
      steam_id TEXT PRIMARY KEY,
      season_key INTEGER NOT NULL DEFAULT 102,
      current_group TEXT,
      active BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

function validSteam(value:unknown){return /^7656119\d{10}$/.test(String(value||""));}

async function cmd(command:string):Promise<string|null>{
  const reply=await executeRconCommand(command);
  if(reply===null)logger.warn({command:command.replace(/7656119\d{10}/g,"STEAMID")},"Season 2 Rust group command failed");
  return reply;
}

async function ensureGroups(){
  if(groupsEnsured)return;
  let success=true;
  for(const rank of ranksForSeason(SEASON)){
    const title=rank.name.replace(/\s+/g,"-");
    const created=await cmd(`chat group add ${rank.group}`);
    const titled=await cmd(`chat group set ${rank.group} title [${title}]`);
    const colored=await cmd(`chat group set ${rank.group} titlecolor #f0b43c`);
    const visible=await cmd(`chat group set ${rank.group} titlehiddenifnotprimary false`);
    if([created,titled,colored,visible].some(reply=>reply===null))success=false;
  }
  groupsEnsured=success;
  if(!success)logger.warn("Season 2 Better Chat groups were not fully confirmed; sync will retry.");
}

async function trackedPlayers(){
  await ensureStateTable();
  const result:any=await db.execute(sql`
    WITH sd AS (
      SELECT steam_id,mmr,kills,updated_at FROM season_players WHERE season_number=${SEASON}
    ),
    adjustments AS (
      SELECT steam_id,COALESCE(SUM(final_value),0) delta
      FROM season_transactions WHERE season_number=${SEASON} AND category='admin' GROUP BY steam_id
    ),
    active AS (
      SELECT r.steam_id,r.status,r.created_at,(sd.steam_id IS NOT NULL) has_activity,
             COALESCE(sd.mmr,${STARTING_MMR})+COALESCE(a.delta,0) effective_mmr,
             COALESCE(sd.kills,0) kills,COALESCE(sd.updated_at,r.created_at) updated_at
      FROM season_official_registrations r
      LEFT JOIN sd ON sd.steam_id=r.steam_id
      LEFT JOIN adjustments a ON a.steam_id=r.steam_id
      WHERE r.season_key=${OFFICIAL_KEY} AND r.status='active'
    ),
    ranked AS (
      SELECT active.*,ROW_NUMBER() OVER(ORDER BY effective_mmr DESC,kills DESC,updated_at ASC NULLS LAST) position FROM active
    ),
    registration_rows AS (
      SELECT r.steam_id,r.status,(sd.steam_id IS NOT NULL) has_activity,
             COALESCE(rank.effective_mmr,${STARTING_MMR}) effective_mmr,COALESCE(rank.position,0) position
      FROM season_official_registrations r
      LEFT JOIN sd ON sd.steam_id=r.steam_id
      LEFT JOIN ranked rank ON rank.steam_id=r.steam_id
      WHERE r.season_key=${OFFICIAL_KEY}
    ),
    season_state AS (SELECT * FROM season_game_rank_state WHERE season_key=${OFFICIAL_KEY})
    SELECT COALESCE(r.steam_id,s.steam_id) steam_id,COALESCE(r.status,'removed') status,
           COALESCE(r.has_activity,FALSE) has_activity,COALESCE(r.effective_mmr,${STARTING_MMR}) effective_mmr,
           COALESCE(r.position,0) position,s.current_group,s.active state_active
    FROM registration_rows r FULL OUTER JOIN season_state s ON s.steam_id=r.steam_id
  `);
  return Array.isArray(result?.rows)?result.rows:[];
}

async function removeGroup(steamId:string,group:string){return(await cmd(`chat user remove ${steamId} ${group}`))!==null;}
async function addGroup(steamId:string,group:string){return(await cmd(`chat user add ${steamId} ${group}`))!==null;}

function adminWords(){
  const extra=String(process.env.SEASON_RUST_ADMIN_GROUPS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  return new Set(["admin","administrator","owner","moderator","mod","staff",...extra]);
}

async function isServerAdmin(steamId:string):Promise<boolean>{
  const reply=await cmd(`chat user info ${steamId}`);
  if(reply===null)return false;
  const body=String(reply).toLowerCase();
  for(const word of adminWords()){
    if(body.includes(word))return true;
  }
  return false;
}

async function normalize(steamId:string,desired:string|null):Promise<boolean>{
  for(const group of [...LEGACY_GROUPS,...GROUPS]){
    if(!(await removeGroup(steamId,group)))return false;
  }
  return desired?addGroup(steamId,desired):true;
}

async function saveState(steamId:string,group:string|null,active:boolean){
  await db.execute(sql`
    INSERT INTO season_game_rank_state(steam_id,season_key,current_group,active,updated_at)
    VALUES(${steamId},${OFFICIAL_KEY},${group},${active},now())
    ON CONFLICT(steam_id) DO UPDATE SET season_key=EXCLUDED.season_key,current_group=EXCLUDED.current_group,active=EXCLUDED.active,updated_at=now()
  `);
}

export async function syncSeason2GameRanksOnce():Promise<void>{
  if(running)return;
  running=true;
  try{
    await ensureGroups();
    const rows=await trackedPlayers();
    let changed=0,cleared=0,failed=0,adminsIgnored=0;
    for(const row of rows){
      const steamId=String(row.steam_id||"").trim();
      if(!validSteam(steamId))continue;
      const serverAdmin=await isServerAdmin(steamId);
      const previous=GROUPS.includes(String(row.current_group||""))?String(row.current_group):null;
      if(serverAdmin){
        adminsIgnored++;
        if(previous||Boolean(row.state_active)){
          if(!(await normalize(steamId,null))){failed++;continue;}
          await saveState(steamId,null,false);cleared++;
        }
        continue;
      }
      const active=String(row.status||"").toLowerCase()==="active";
      const xp=xpFromMmr(row.effective_mmr,STARTING_MMR);
      const desired=active?rankForSeason(SEASON,xp,row.position).group:null;
      const hasState=row.state_active!==null&&row.state_active!==undefined;
      if(!hasState){
        if(!(await normalize(steamId,desired))){failed++;continue;}
        await saveState(steamId,desired,active);
        if(desired)changed++;else cleared++;
        continue;
      }
      if(!active){
        if(previous&&!(await removeGroup(steamId,previous))){failed++;continue;}
        await saveState(steamId,null,false);cleared++;continue;
      }
      if(previous===desired&&Boolean(row.state_active))continue;
      if(previous&&previous!==desired&&!(await removeGroup(steamId,previous))){failed++;continue;}
      if(!desired||!(await addGroup(steamId,desired))){failed++;continue;}
      await saveState(steamId,desired,true);changed++;
    }
    if(changed||cleared||failed||adminsIgnored)logger.info({tracked:rows.length,changed,cleared,failed,adminsIgnored},"Season 2 Rust group sync completed");
  }catch(error){logger.error({error},"Season 2 Rust group sync failed");}
  finally{running=false;}
}

export function startSeason2GameRankSync():void{
  if(timer)return;
  void syncSeason2GameRanksOnce();
  timer=setInterval(()=>void syncSeason2GameRanksOnce(),60_000);
  timer.unref?.();
}
