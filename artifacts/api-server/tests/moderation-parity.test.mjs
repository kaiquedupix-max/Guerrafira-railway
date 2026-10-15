import { test, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { writeFile, unlink } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";

const client = new PGlite();
await client.exec("CREATE TABLE mod_logs (id SERIAL PRIMARY KEY, server_id TEXT NOT NULL DEFAULT 'solo-duo', action TEXT NOT NULL, steam_id TEXT NOT NULL, player_name TEXT NOT NULL, reason TEXT, admin_id TEXT NOT NULL, admin_name TEXT NOT NULL, ban_duration TEXT, ban_expires_at TIMESTAMPTZ, public_visible BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
const table = pgTable("mod_logs", {
 id: serial("id").primaryKey(), serverId: text("server_id").notNull().default("solo-duo"),
 action: text("action").notNull(), steamId: text("steam_id").notNull(), playerName: text("player_name").notNull(),
 reason: text("reason"), adminId: text("admin_id").notNull(), adminName: text("admin_name").notNull(),
 banDuration: text("ban_duration"), banExpiresAt: timestamp("ban_expires_at", {withTimezone:true}),
 publicVisible: boolean("public_visible").default(true), createdAt: timestamp("created_at", {withTimezone:true}).defaultNow(),
});
const state = globalThis.__moderationParity = { db: drizzle(client), table, commands: [], online: [], fail: false };
const built = await build({ stdin: {
 contents: 'export * from "./src/core/systemActions.ts";export * from "./src/core/adminServerContext.ts";export * from "./src/core/discordServerContext.ts";',
 resolveDir: process.cwd(), loader: "ts",
}, bundle: true, platform: "node", format: "esm", packages: "external", write: false,
 plugins: [{name:"moderation-adapters",setup(b){
 b.onResolve({filter:/^@workspace\/db$|bot\/client\.js|utils\/rcon\.js|utils\/players\.js|admin\/steamProfiles\.js|lib\/logger\.js/},a=>({path:a.path,namespace:"mock"}));
 b.onLoad({filter:/.*/,namespace:"mock"},a=>({contents:
 a.path==="@workspace/db" ? "export const db=globalThis.__moderationParity.db,modLogsTable=globalThis.__moderationParity.table,playersTable={};" :
 a.path.includes("players") ? 'export const getPlayerBySteamId=async steamId=>({steamId,playerName:"Tester",isOnline:false});' :
 a.path.includes("rcon") ? "export const executeRconCommand=cmd=>globalThis.__moderationParity.run(cmd);export const getOnlinePlayers=async()=>globalThis.__moderationParity.online;" :
 a.path.includes("client") ? "export const discordClient=()=>null;" :
 a.path.includes("steamProfiles") ? "export const getSteamProfileSummaries=async()=>new Map();" :
 "export const logger={warn(){},error(){}};",
 }));
 }}]});
const file = new URL("./.moderation-parity-bundle.mjs",import.meta.url);
await writeFile(file,built.outputFiles[0].text);
const api=await import(file.href);
await unlink(file);
state.run=async command=>{state.commands.push({server:api.adminServer(),command});return (state.fail || state.failServer===api.adminServer())?"Unknown command":"";};
const steamId="76561190000000002",actor={id:"admin",name:"Admin",source:"web"};
after(async()=>{await client.close();delete globalThis.__moderationParity;});

test("a ban initiated in Duo is applied and audited on both servers",async()=>{
 await api.withAdminServer("solo-duo",()=>api.banPlayer({steamId,duration:"3d",reason:"Teste",actor}));
 const rows=(await client.query("SELECT server_id, action FROM mod_logs ORDER BY server_id")).rows;
 assert.deepEqual(rows.map(r=>r.server_id),["solo-duo","trio"]);
 assert.equal(state.commands.filter(c=>c.command.startsWith("banid ")).length,2);
 assert.equal(await api.withAdminServer("trio",()=>api.activeBan(steamId)).then(x=>x.serverId),"trio");
});

test("unbanning from Trio removes the ban on both servers",async()=>{
 state.commands=[];
 await api.withAdminServer("trio",()=>api.unbanPlayer({steamId,reason:"Recurso",actor}));
 assert.equal(await api.withAdminServer("trio",()=>api.activeBan(steamId)),null);
 assert.equal(await api.withAdminServer("solo-duo",()=>api.activeBan(steamId)),null);
 assert.ok(state.commands.length>0);
 assert.ok(state.commands.some(c=>c.server==="trio" && c.command.startsWith("unban ")));
 assert.ok(state.commands.some(c=>c.server==="solo-duo" && c.command.startsWith("unban ")));
});

test("Rust rejection does not record a successful ban",async()=>{
 state.fail=true;
 try { await assert.rejects(api.withAdminServer("trio",()=>api.banPlayer({steamId,duration:"perm",reason:"Teste",actor})),/sincronização pendente/); }
 finally { state.fail=false; }
 assert.equal((await client.query("SELECT count(*)::int AS n FROM mod_logs WHERE action='BAN'")).rows[0].n,2);
});

test("kick checks the selected server live roster and uses the SteamID",async()=>{
 state.online=[{steamId,name:"Trio online",ping:10}];state.commands=[];
 await api.withAdminServer("trio",()=>api.kickPlayer({steamId,reason:"Teste",actor}));
 assert.equal(state.commands[0].server,"trio");
 assert.ok(state.commands[0].command.startsWith("kick "+steamId+" "));
 state.online=[];
 await assert.rejects(api.withAdminServer("trio",()=>api.kickPlayer({steamId,reason:"Teste",actor})),/offline/);
});

test("slash and menu server option keeps asynchronous commands isolated",async()=>{
 const fake=server=>({options:{getString:()=>server}});
 assert.equal(await api.runForCommandServer(fake("trio"),async()=>{await Promise.resolve();return api.adminServer();}),"trio");
 assert.equal(api.runForCommandServer(fake(null),()=>api.adminServer()),"solo-duo");
 assert.throws(()=>api.runForCommandServer(fake("invalid"),()=>{}),/inválido/);
 assert.equal(api.adminServer(),"solo-duo");
});

test("a Trio ban also reaches Duo and keeps identical expiry",async()=>{
 const id="76561190000000003";
 await api.withAdminServer("trio",()=>api.banPlayer({steamId:id,duration:"7d",reason:"Rede",actor}));
 const rows=(await client.query("SELECT server_id,ban_expires_at FROM mod_logs WHERE steam_id=$1 AND action='BAN'",[id])).rows;
 assert.equal(rows.length,2);
 assert.equal(new Date(rows[0].ban_expires_at).getTime(),new Date(rows[1].ban_expires_at).getTime());
});

test("a failed mirror is durably queued and retried with its original expiration",async()=>{
 const id="76561190000000004";
 state.failServer="trio";
 await assert.rejects(api.banPlayer({steamId:id,duration:"3d",reason:"Rede",actor}),/Trio/);
 state.failServer=null;
 const original=(await client.query("SELECT ban_expires_at FROM mod_logs WHERE steam_id=$1 AND action='BAN_SYNC_PENDING'",[id])).rows[0];
 await api.syncPendingNetworkBans();
 const rows=(await client.query("SELECT server_id,ban_expires_at FROM mod_logs WHERE steam_id=$1 AND action='BAN'",[id])).rows;
 assert.equal(rows.length,2);
 assert.equal(new Date(rows.find(r=>r.server_id==="trio").ban_expires_at).getTime(),new Date(original.ban_expires_at).getTime());
 assert.equal((await client.query("SELECT count(*)::int AS n FROM mod_logs WHERE steam_id=$1 AND action='BAN_SYNC_PENDING'",[id])).rows[0].n,0);
});

test("a subsequent network unban cancels a failed ban mirror",async()=>{
 const id="76561190000000005";
 state.failServer="trio";
 await assert.rejects(api.banPlayer({steamId:id,duration:"perm",reason:"Rede",actor}),/pendente/);
 state.failServer=null;
 await api.unbanPlayer({steamId:id,reason:"Revisão",actor});
 state.commands=[];
 await api.syncPendingNetworkBans();
 assert.equal(state.commands.some(c=>c.command.startsWith("banid "+id)),false);
});

test("preventive bans are network-wide too",async()=>{
 const id="76561190000000006";
 await api.withAdminServer("trio",()=>api.preventiveBanPlayer({steamId:id,reason:"Verificar",actor}));
 const rows=(await client.query("SELECT server_id FROM mod_logs WHERE steam_id=$1 AND action='PREVENTIVE_BAN'",[id])).rows;
 assert.equal(rows.length,2);
});

test("an unavailable server receives an unban after a queued temporary ban has expired",async()=>{
 const id="76561190000000007";
 state.failServer="trio";
 await assert.rejects(api.banPlayer({steamId:id,duration:"3d",reason:"Temporário",actor}),/pendente/);
 state.failServer=null;
 await client.query("UPDATE mod_logs SET ban_expires_at=NOW()-INTERVAL '1 minute' WHERE steam_id=$1",[id]);
 state.commands=[];
 await api.syncPendingNetworkBans();
 assert.equal(state.commands.some(c=>c.command.startsWith("banid "+id)),false);
 assert.ok(state.commands.some(c=>c.server==="trio"&&c.command==="unban "+id));
});
test("a failed network unban retries only the unconfirmed server",async()=>{
 const id="76561190000000008";
 await api.banPlayer({steamId:id,duration:"perm",reason:"Rede",actor});
 state.failServer="trio";
 await assert.rejects(api.unbanPlayer({steamId:id,reason:"Recurso",actor}),/Trio/);
 state.failServer=null;state.commands=[];
 await api.syncPendingNetworkBans();
 assert.ok(state.commands.some(c=>c.server==="trio"&&c.command==="unban "+id));
 assert.equal(state.commands.some(c=>c.server==="solo-duo"&&c.command==="unban "+id),false);
 assert.equal(await api.withAdminServer("trio",()=>api.activeBan(id)),null);
});
