import { db, playersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminServer } from "../../core/adminServerContext.js";
import { directoryPlayers, directoryPlayer } from "../../core/playerDirectory.js";
import type { RconPlayer } from "./rcon.js";
export async function upsertPlayer(player:RconPlayer):Promise<void>{
  await db.insert(playersTable).values({steamId:player.steamId,playerName:player.name,isOnline:true,lastSeen:new Date()})
    .onConflictDoUpdate({target:playersTable.steamId,set:{playerName:player.name,isOnline:true,lastSeen:new Date()}});
}
export async function setAllOffline():Promise<void>{await db.update(playersTable).set({isOnline:false});}
export async function searchPlayers(query:string,limit=25){return(await directoryPlayers(query,limit)).rows;}
export async function getAllPlayers(limit=25){return searchPlayers("",limit);}
export async function getPlayersPage(query:string,page:number,pageSize=10){return directoryPlayers(query,pageSize,Math.max(0,page)*pageSize);}
export async function getPlayerBySteamId(steamId:string){
  const current=await directoryPlayer(steamId);if(current||adminServer()==="trio")return current;
  const [row]=await db.select().from(playersTable).where(eq(playersTable.steamId,steamId)).limit(1);return row||null;
}
