import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFile, unlink } from 'node:fs/promises';
const state={rows:[],rcon:[],audit:[],stillBanned:false};
globalThis.__unbanIntegration={state,db:{select(){const chain={from(){return chain;},where(){return chain;},orderBy(){return chain;},async limit(){return state.rows.shift()??[];}};return chain;},insert(){return {async values(row){state.audit.push(row);}};}},run:async cmd=>{state.rcon.push(cmd);return cmd==='banlist' && state.stillBanned?'76561190000000002 Duo':'';}};
const result=await build({entryPoints:['src/core/systemActions.ts'],bundle:true,platform:'node',format:'esm',packages:'external',write:false,plugins:[{name:'adapters',setup(b){
 b.onResolve({filter:/^@workspace\/db$|^drizzle-orm$|bot\/client\.js|utils\/players\.js|utils\/rcon\.js|admin\/steamProfiles\.js|lib\/logger\.js|ipModeration\.js/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='@workspace/db'?'export const db=globalThis.__unbanIntegration.db;export const modLogsTable={},playersTable={};':a.path==='drizzle-orm'?'export const eq=()=>null,desc=()=>null,and=()=>null,inArray=()=>null;':a.path.includes('players')?'export const getPlayerBySteamId=async()=>globalThis.__unbanIntegration.state.rows.shift()?.[0];':a.path.includes("ipModeration") ? "export const collectPlayerAddresses=async()=>['203.0.113.1'],protectPlayerIp=async()=>true,removePlayerIpBan=async()=>{};" : a.path.includes('client')?'export const discordClient=()=>null;':a.path.includes('rcon')?'export const executeRconCommand=globalThis.__unbanIntegration.run;export const getOnlinePlayers=async()=>[];':a.path.includes('steamProfiles')?'export const getSteamProfileSummaries=async()=>new Map();':'export const logger={warn(){},error(){}};'}));
}}]});
const file=new URL('./.unban-integration-bundle.mjs',import.meta.url);await writeFile(file,result.outputFiles[0].text);const {unbanPlayer}=await import(file.href);await unlink(file);
const input={steamId:'76561190000000002',reason:'Recurso aprovado',actor:{id:'admin',name:'Admin',source:'discord'}};
test('a Rust ban without a local history entry can be removed and audited',async()=>{
 state.rows=[[],[]];state.rcon=[];state.audit=[];state.stillBanned=false;
 const result=await unbanPlayer(input);assert.equal(result.playerName,'Jogador (76561190000000002)');assert.equal(state.audit.length,2);assert.ok(state.audit.every(x=>x.action==='DESBANIR'));assert.deepEqual(state.audit.map(x=>x.serverId).sort(),['solo-duo','trio']);assert.equal(state.rcon.filter(c=>c==='unban 76561190000000002').length,2);assert.equal(state.rcon.filter(c=>c==='banlist').length,2);assert.equal(state.rcon.filter(c=>c==='server.writecfg').length,2);
});
test('a remaining server ban does not create a false unban audit record',async()=>{
 state.rows=[[],[]];state.rcon=[];state.audit=[];state.stillBanned=true;
 await assert.rejects(unbanPlayer(input),/sincronização pendente/);assert.equal(state.audit.filter(x=>x.action==='DESBANIR').length,0);assert.equal(state.audit.filter(x=>x.action==='UNBAN_SYNC_PENDING').length,2);assert.equal(state.rcon.some(c=>c.startsWith('say ')),false);
});
