import {adminServer} from "../core/adminServerContext.js";
import {subscriptionServer} from "../routes/storeOrders.js";
import {getOnlinePlayers} from "../bot/utils/rcon.js";
import { Router } from "express";
import { desc } from "drizzle-orm";
import { db, playersTable, modLogsTable, boosterLinksTable, vipSubscriptionsTable } from "@workspace/db";
import { getServerInfo } from "../bot/utils/rcon.js";
import { getAdminSessionV3 } from "./sessionBearer.js";
import { requireAdmin } from "./guard.js";
import { isDiscordAdministrator } from "./permissions.js";

const router = Router();
router.use(requireAdmin);

const overviewCaches=new Map<string,{data:any,at:number,inFlight?:Promise<any>}>();
async function serverVips(){const rows=await db.select().from(vipSubscriptionsTable).orderBy(desc(vipSubscriptionsTable.expiresAt)).limit(1000);const scoped=await Promise.all(rows.map(async row=>({row,server:await subscriptionServer(row.source)})));return scoped.filter(x=>x.server===adminServer()).map(x=>x.row);}
async function serverPlayers(){if(adminServer()==="solo-duo")return db.select().from(playersTable).orderBy(desc(playersTable.lastSeen)).limit(1000);return(await getOnlinePlayers()).map((p,i)=>({id:i+1,steamId:p.steamId,playerName:p.name,isOnline:true,firstSeen:null,lastSeen:new Date().toISOString()}));}
async function buildOverview(){const [server,players,vips]=await Promise.all([getServerInfo(),serverPlayers(),serverVips()]);const links=await db.select().from(boosterLinksTable);const mods=adminServer()==="trio"?[]:await db.select().from(modLogsTable).orderBy(desc(modLogsTable.createdAt)).limit(20);return{server,serverId:adminServer(),summary:{knownPlayers:players.length,onlinePlayers:server?.players||0,linkedSteam:links.length,activeBoosters:adminServer()==="trio"?0:links.filter(p=>p.active).length,activeVips:vips.filter(v=>(!v.gameVipRemoved||!v.discordRoleRemoved)&&new Date(v.expiresAt).getTime()>Date.now()).length},recentModeration:mods};}

router.get("/me", async (req, res) => {
  const session = getAdminSessionV3(req);
  const canViewFinance = session ? await isDiscordAdministrator(session.userId) : false;
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.status(200).json({ user: session, capabilities: { canViewFinance } });
});

router.get("/overview",async(_req,res)=>{const id=adminServer();let cache=overviewCaches.get(id);if(!cache){cache={data:null,at:0};overviewCaches.set(id,cache);}try{if(cache.data&&Date.now()-cache.at<5000)return void res.json(cache.data);if(!cache.inFlight)cache.inFlight=buildOverview().then(data=>{cache!.data=data;cache!.at=Date.now();return data}).finally(()=>{cache!.inFlight=undefined});res.json(await cache.inFlight);}catch{res.status(503).json({error:"Servidor temporariamente indisponível.",serverId:id});}});

router.get("/players", async (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const rows = await serverPlayers();
  const filtered = q ? rows.filter(p => p.playerName.toLowerCase().includes(q) || p.steamId.includes(q)) : rows;
  res.json({ players: filtered.slice(0, 500) });
});

router.get("/modlogs", async (_req, res) => {
  const rows = await db.select().from(modLogsTable).orderBy(desc(modLogsTable.createdAt)).limit(200);
  res.json({ logs: adminServer()==="trio"?[]:rows });
});

router.get("/steam-links", async (_req, res) => {
  res.json({ links: await db.select().from(boosterLinksTable).limit(1000) });
});

router.get("/vips", async (_req, res) => {
  const rows = await serverVips();
  res.json({ vips: rows });
});

export default router;
