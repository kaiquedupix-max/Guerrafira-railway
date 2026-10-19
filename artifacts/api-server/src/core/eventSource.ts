import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { parseServerId, type GuerraFriaServerId } from "./servers.js";
export class EventSourceError extends Error{constructor(message:string,public status=400){super(message)}}
const matches=(received:string,expected:string)=>{const a=Buffer.from(received),b=Buffer.from(expected);return a.length===b.length&&a.length>0&&timingSafeEqual(a,b)};
export function authenticatedEventServer(req:Request,kind:"season"|"leaderboard"):GuerraFriaServerId{
 const key=kind==="season"?"x-gf-season-secret":"x-gf-leaderboard-secret";
 const received=String(req.get(key)||"").trim();
 const shared=kind==="season"?process.env.SEASON_WEBHOOK_SECRET||process.env.LEADERBOARD_WEBHOOK_SECRET:process.env.LEADERBOARD_WEBHOOK_SECRET||process.env.SEASON_WEBHOOK_SECRET;
 const sharedValues=(kind==="leaderboard"?[process.env.LEADERBOARD_WEBHOOK_SECRET,process.env.SEASON_WEBHOOK_SECRET]:[shared]).map(value=>value?.trim()).filter((value):value is string=>Boolean(value));
 const trio=kind==="season"?process.env.TRIO_SEASON_WEBHOOK_SECRET:process.env.TRIO_LEADERBOARD_WEBHOOK_SECRET;
 if(!shared?.trim()&&!trio?.trim())throw new EventSourceError("Segredo do webhook não configurado.",503);
 const claimed=req.get("X-GF-Server")??req.query.server??req.body?.server_id;
 const server=claimed===undefined?(trio&&matches(received,trio.trim())&&!sharedValues.some(value=>matches(received,value))?"trio":"solo-duo"):parseServerId(claimed);
 if(!server)throw new EventSourceError("Servidor de origem inválido.");
 const expected=server==="trio"&&trio?.trim()?[trio.trim()]:sharedValues;
 if(!expected.some(value=>matches(received,value)))throw new EventSourceError("Assinatura do webhook inválida para o servidor.",401);
 return server;
}
export function eventKey(server:GuerraFriaServerId,id:string):string{return server==="trio"?`trio:${id}`:id;}
