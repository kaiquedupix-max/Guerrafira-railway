import { pool } from "@workspace/db";

export interface WipeLockState { unlocked:boolean; updatedBy:string|null; updatedAt:string|null; }
let ready=false;
async function ensureTable():Promise<void>{
  if(ready)return;
  await pool.query(`CREATE TABLE IF NOT EXISTS wipe_runtime_settings (id INTEGER PRIMARY KEY, unlocked BOOLEAN NOT NULL DEFAULT FALSE, updated_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const defaultUnlocked=process.env.WIPE_EXECUTION_ENABLED==="true"&&process.env.WIPE_AUTOMATION_ENABLED==="true";
  await pool.query(`INSERT INTO wipe_runtime_settings (id,unlocked) VALUES (1,$1) ON CONFLICT (id) DO NOTHING`,[defaultUnlocked]);ready=true;
}
export async function getWipeLockState():Promise<WipeLockState>{await ensureTable();const result=await pool.query(`SELECT unlocked,updated_by,updated_at FROM wipe_runtime_settings WHERE id=1`);const row=result.rows[0];return{unlocked:row?.unlocked===true,updatedBy:row?.updated_by??null,updatedAt:row?.updated_at instanceof Date?row.updated_at.toISOString():row?.updated_at??null};}
export async function setWipeLock(unlocked:boolean,updatedBy:string):Promise<WipeLockState>{await ensureTable();await pool.query(`UPDATE wipe_runtime_settings SET unlocked=$1,updated_by=$2,updated_at=NOW() WHERE id=1`,[unlocked,updatedBy]);return getWipeLockState();}
export async function assertWipeUnlocked():Promise<void>{const state=await getWipeLockState();if(!state.unlocked)throw new Error("Sistema de wipe travado pela administração.");}
