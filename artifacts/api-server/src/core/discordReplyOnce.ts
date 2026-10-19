import { pool } from "@workspace/db";
let ready:Promise<void>|undefined;
function ensureTable(){return ready??=pool.query(`CREATE TABLE IF NOT EXISTS discord_auto_replies(message_id TEXT NOT NULL,kind TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(message_id,kind))`).catch(error=>{ready=undefined;throw error;});}
/** A persistent claim protects overlapping deployments, not just one client. */
export async function onceDiscordReply(messageId:string,kind:string,send:()=>Promise<unknown>):Promise<boolean>{
 await ensureTable();
 const claim=await pool.query("INSERT INTO discord_auto_replies(message_id,kind) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING message_id",[messageId,kind]);
 if(!claim.rows.length)return false;
 try{await send();return true;}catch(error){
  await pool.query("DELETE FROM discord_auto_replies WHERE message_id=$1 AND kind=$2",[messageId,kind]);
  throw error;
 }
}
