import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
const pg=new PGlite();await pg.exec('CREATE TABLE players(steam_id TEXT,player_name TEXT,first_seen TIMESTAMPTZ,last_seen TIMESTAMPTZ)');
const query=async(sql,params)=>!params&&sql.includes(';')?(await pg.exec(sql),{rows:[]}):pg.query(sql,params);
const state=globalThis.__directory={pool:{query,connect:async()=>({query,release(){}})},online:{'solo-duo':[],trio:[]},calls:0,fail:false};
const built=await build({stdin:{contents:'export * from "./src/core/playerDirectory.ts";export * from "./src/core/adminServerContext.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,packages:'external',plugins:[{name:'directory-adapters',setup(b){
 b.onResolve({filter:/^@workspace\/db$|utils\/rcon\.js|lib\/logger\.js/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='@workspace/db'?'export const pool=globalThis.__directory.pool;':a.path.includes('rcon')?'export const getOnlinePlayers=async()=>{const s=globalThis.__directory;s.calls++;if(s.fail)throw Error("offline");return s.online[s.server()];};':'export const logger={warn(){}};'}));
}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));state.server=api.adminServer;
after(()=>pg.close());
test('persistent Duo and Trio directories isolate names, online flags, IPs and paginated searches',async()=>{
 const id='76561190000000001';state.online['solo-duo']=[{steamId:id,name:'Duo Name',ping:12,ipAddress:'203.0.113.1:1234'}];state.online.trio=Array.from({length:300},(_,i)=>({steamId:i===0?id:'7656119'+String(i+1).padStart(10,'0'),name:i===0?'Trio Name':'Trio '+i,ping:20}));
 await api.refreshPlayerDirectory('solo-duo');await api.refreshPlayerDirectory('trio');
 assert.equal((await api.directoryPlayers()).rows[0].playerName,'Duo Name');
 const page=await api.withAdminServer('trio',()=>api.directoryPlayers('',100,100,'online'));assert.equal(page.total,300);assert.equal(page.rows.length,100);
 const result=await api.withAdminServer('trio',()=>api.directoryPlayers('Trio Name'));assert.equal(result.rows.length,1);assert.equal(result.rows[0].playerName,'Trio Name');assert.equal('last_ip' in result.rows[0],false);
 assert.deepEqual(await api.knownPlayerAddresses(id),['203.0.113.1:1234']);
});
test('read searches never issue live RCON requests and concurrent refreshes are shared',async()=>{
 const calls=state.calls;await Promise.all(Array.from({length:20},()=>api.withAdminServer('trio',()=>api.directoryPlayers('Trio'))));assert.equal(state.calls,calls);
 await Promise.all([api.refreshPlayerDirectory('trio'),api.refreshPlayerDirectory('trio')]);assert.equal(state.calls,calls+1);
});
test('RCON failure does not mark all players offline; a confirmed empty list does',async()=>{
 state.fail=true;await assert.rejects(api.refreshPlayerDirectory('trio'),/offline/);state.fail=false;
 assert.equal((await api.withAdminServer('trio',()=>api.directoryPlayers('',10,0,'online'))).total,300);
 state.online.trio=[];await api.refreshPlayerDirectory('trio');assert.equal((await api.withAdminServer('trio',()=>api.directoryPlayers('',10,0,'online'))).total,0);
 assert.equal((await api.withAdminServer('trio',()=>api.directoryPlayers())).total,300);
});
