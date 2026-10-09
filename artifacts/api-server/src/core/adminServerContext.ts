import {AsyncLocalStorage} from "node:async_hooks";
import type {RequestHandler} from "express";
import {parseServerId,type GuerraFriaServerId} from "./servers.js";
const context=new AsyncLocalStorage<GuerraFriaServerId>();
export const adminServer=()=>context.getStore()||"solo-duo";
export const withAdminServer=<T>(server:GuerraFriaServerId,run:()=>T):T=>context.run(server,run);
export const adminServerMiddleware:RequestHandler=(req,res,next)=>{
 const supplied=req.get("X-GF-Server")??req.query.server??"solo-duo",server=parseServerId(supplied);
 if(!server)return void res.status(400).json({error:"Servidor inválido."});
 res.setHeader("X-GF-Server",server);res.setHeader("Cache-Control","no-store");
 context.run(server,next);
};
export function hostSettings(){const trio=adminServer()==="trio";return{
 panelUrl:String((trio?process.env.TRIO_PANEL_URL:process.env.ELGAE_PANEL_URL)||process.env.ELGAE_PANEL_URL||"").replace(/\/$/,""),
 serverId:String(trio?process.env.TRIO_PANEL_SERVER_ID||"ad506a79":process.env.ELGAE_SERVER_ID||""),
 apiKey:String((trio?process.env.TRIO_PANEL_API_KEY:process.env.ELGAE_API_KEY)||process.env.ELGAE_API_KEY||"")
};}
