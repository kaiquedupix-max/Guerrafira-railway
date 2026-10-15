import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const handlers=globalThis.__liveOpsHandlers={};
const built=await build({stdin:{contents:'export * from "./src/admin/liveOps.ts";export * from "./src/core/adminServerContext.ts";',resolveDir:process.cwd(),loader:"ts"},bundle:true,platform:"node",format:"esm",packages:"external",write:false,plugins:[{name:"live-adapters",setup(b){
 b.onResolve({filter:/utils\/rcon\.js|utils\/serverRcon\.js|adminNotifications\.js/},a=>({path:a.path,namespace:"mock"}));
 b.onLoad({filter:/.*/,namespace:"mock"},a=>({contents:a.path.includes("serverRcon")?'export const addTrioRconEventHandler=h=>{globalThis.__liveOpsHandlers.trio=h;return ()=>{}};':a.path.includes("rcon")?'export const setRconEventHandler=h=>{globalThis.__liveOpsHandlers.duo=h;};':'export const notifySubscribedAdmins=async()=>{},pushAdminAlert=()=>{};'}));
}}]});
const api=await import("data:text/javascript;base64,"+Buffer.from(built.outputFiles[0].text).toString("base64"));
api.initLiveOps();
test("Duo and Trio chat, deduplication and moderator history remain isolated",()=>{
 const raw=JSON.stringify({Username:"Tester",UserId:"76561190000000002",Message:"Olá",Channel:0});
 handlers.duo("Chat",raw);handlers.trio("Chat",raw);handlers.trio("Chat",raw);
 assert.equal(api.getLiveChat().length,1);
 assert.equal(api.withAdminServer("trio",()=>api.getLiveChat().length),1);
 api.withAdminServer("trio",()=>api.addModeratorChat("Admin","Mensagem Trio"));
 assert.equal(api.getLiveChat().length,1);
 assert.equal(api.withAdminServer("trio",()=>api.getLiveChat().at(-1).message),"Mensagem Trio");
 assert.notEqual(api.getLiveEvents()[0],api.withAdminServer("trio",()=>api.getLiveEvents()[0]));
});
