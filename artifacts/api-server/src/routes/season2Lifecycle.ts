import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { SEASON_1_END_AT, SEASON_2_END_AT, SEASON_2_START_AT } from "./seasonRanks.js";

const SEASON_2_ID = "gf-s2-20261002";
const S1_END = new Date(SEASON_1_END_AT).getTime();
const S2_START = new Date(SEASON_2_START_AT).getTime();
const S2_END = new Date(SEASON_2_END_AT).getTime();
let timer: NodeJS.Timeout | null = null;
let running = false;

export function scoringSeasonForTime(now = Date.now()): number | null {
  if (now <= S1_END) return 1;
  if (now >= S2_START && now <= S2_END) return 2;
  return null;
}

async function ensureInfrastructure(){
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS seasons (
      season_number INTEGER PRIMARY KEY,
      season_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      starting_mmr DOUBLE PRECISION NOT NULL DEFAULT 1000,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ended_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS season_control (
      season_number INTEGER PRIMARY KEY,
      scoring_blocked BOOLEAN NOT NULL DEFAULT FALSE,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      changed_by TEXT,
      last_reset_at TIMESTAMPTZ,
      last_reset_by TEXT
    )
  `);
  await db.execute(sql`
    INSERT INTO season_control(season_number,scoring_blocked)
    VALUES(2,FALSE) ON CONFLICT(season_number) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO seasons(season_number,season_id,status,starting_mmr,started_at,ended_at,updated_at)
    VALUES(2,${SEASON_2_ID},'scheduled',1000,${new Date(SEASON_2_START_AT)},NULL,now())
    ON CONFLICT(season_number) DO NOTHING
  `);
}

export async function syncSeason2LifecycleOnce():Promise<void>{
  if(running)return;
  running=true;
  try{
    await ensureInfrastructure();
    const now=Date.now();
    if(now<=S1_END){
      await db.execute(sql`UPDATE seasons SET status='scheduled',started_at=${new Date(SEASON_2_START_AT)},ended_at=NULL,updated_at=now() WHERE season_number=2 AND status<>'scheduled'`);
      return;
    }
    if(now<S2_START){
      await db.execute(sql`UPDATE seasons SET status='finished',ended_at=COALESCE(ended_at,${new Date(SEASON_1_END_AT)}),updated_at=now() WHERE season_number=1 AND status='active'`);
      await db.execute(sql`UPDATE seasons SET status='scheduled',started_at=${new Date(SEASON_2_START_AT)},ended_at=NULL,updated_at=now() WHERE season_number=2`);
      return;
    }
    if(now<=S2_END){
      await db.execute(sql`UPDATE seasons SET status='finished',ended_at=COALESCE(ended_at,${new Date(SEASON_1_END_AT)}),updated_at=now() WHERE season_number<>2 AND status='active'`);
      await db.execute(sql`UPDATE seasons SET season_id=${SEASON_2_ID},status='active',starting_mmr=1000,started_at=${new Date(SEASON_2_START_AT)},ended_at=NULL,updated_at=now() WHERE season_number=2`);
      return;
    }
    await db.execute(sql`UPDATE seasons SET status='finished',ended_at=COALESCE(ended_at,${new Date(SEASON_2_END_AT)}),updated_at=now() WHERE season_number=2`);
  }catch(error){logger.error({error},"Season 2 lifecycle sync failed");}
  finally{running=false;}
}

export function startSeason2Lifecycle():void{
  if(timer)return;
  void syncSeason2LifecycleOnce();
  timer=setInterval(()=>void syncSeason2LifecycleOnce(),60_000);
  timer.unref?.();
}
