import { directoryPlayers } from "../core/playerDirectory.js";
import { cachedRead } from "../core/readCache.js";
import {adminServer} from "../core/adminServerContext.js";
import {subscriptionServers} from "../routes/storeOrders.js";
import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db, modLogsTable, boosterLinksTable, vipSubscriptionsTable } from "@workspace/db";
import { getServerInfo } from "../bot/utils/rcon.js";
import { getAdminSessionV3 } from "./sessionBearer.js";
import { requireAdmin } from "./guard.js";
import { isDiscordAdministrator } from "./permissions.js";

const router = Router();
router.use(requireAdmin);

const overviewCaches=new Map<string,{data:any,at:number,inFlight?:Promise<any>}>();
async function serverVips(){return cachedRead("admin-vips",readServerVips,10000,0);}
async function readServerVips(){const rows=await db.select().from(vipSubscriptionsTable).orderBy(desc(vipSubscriptionsTable.expiresAt)).limit(1000);const scopes=await subscriptionServers(rows.map(row=>row.source));return rows.filter(row=>scopes.get(row.source)===adminServer());}
async function serverPlayers(){return directoryPlayers("",1); }
async function buildOverview(){const [server,players,vips]=await Promise.all([getServerInfo().catch(()=>null),serverPlayers(),serverVips().catch(()=>[])]);const links=await db.select().from(boosterLinksTable);const mods=await db.select().from(modLogsTable).where(eq(modLogsTable.serverId,adminServer())).orderBy(desc(modLogsTable.createdAt)).limit(20);return{server,serverId:adminServer(),summary:{knownPlayers:players.total,onlinePlayers:server?.players||0,linkedSteam:links.length,activeBoosters:links.filter(p=>p.active).length,activeVips:vips.filter(v=>(!v.gameVipRemoved||!v.discordRoleRemoved)&&new Date(v.expiresAt).getTime()>Date.now()).length},recentModeration:mods};}

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
  const result = await directoryPlayers(q, Number(req.query.limit)||100, Number(req.query.offset)||0, String(req.query.mode||"all"));
  res.json({ players: result.rows, total: result.total, serverId: adminServer() });
});

router.get("/modlogs", async (_req, res) => {
  const rows = await db.select().from(modLogsTable).where(eq(modLogsTable.serverId,adminServer())).orderBy(desc(modLogsTable.createdAt)).limit(200);
  res.json({ logs: rows });
});

router.get("/steam-links", async (_req, res) => {
  res.json({ links: await db.select().from(boosterLinksTable).limit(1000) });
});

router.get("/vips", async (_req, res) => {
  const rows = await serverVips();
  res.json({ vips: rows });
});

export default router;
