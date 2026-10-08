import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const s=globalThis.__vipMigrationTests={done:new Set(),calls:[],fail:2,rows:[{id:1,source:'purchase'},{id:2,source:'purchase'},{id:3,source:'manual:trio'}]};
s.pool={connect:async()=>({query:async(sql,args)=>{
 if(sql.includes('pg_try'))return {rows:[{locked:true}]};
 if(sql.startsWith('SELECT 1'))return {rowCount:s.done.has('complete')?1:0};
 if(sql.startsWith('SELECT entitlement'))return {rows:[...s.done].map(entitlement=>({entitlement}))};
 if(sql.startsWith('INSERT'))s.done.add(args[1]||'complete');
 return {rows:[]};
},release(){}})};
s.db={select:()=>({from:()=>({where:async()=>s.rows})})};
const mocks={'@workspace/db':'export const db=globalThis.__vipMigrationTests.db;export const pool=globalThis.__vipMigrationTests.pool;export const vipSubscriptionsTable={};','vip.js':'export const reapplyDuoVip=async id=>{let s=globalThis.__vipMigrationTests;s.calls.push(id);if(id===s.fail)throw Error("RCON offline");return true;};','storeOrders.js':'export const subscriptionServer=async source=>source==="manual:trio"?"trio":"solo-duo";','logger.js':'export const logger={info(){},error(){}};'};
const b=await build({entryPoints:[resolve('src/bot/vipMigration.ts')],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'mocks',setup(p){p.onResolve({filter:/.*/},a=>{let k=Object.keys(mocks).find(k=>a.path===k||a.path.endsWith('/'+k));if(k)return {path:k,namespace:'mock'};});p.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const mod={exports:{}};new Function('require','module','exports',b.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
test('one-time migration checkpoints successes, retries failures and never repeats after completion',async()=>{
 assert.equal(await mod.exports.restoreDuoVipsOnce({}),false);assert.deepEqual(s.calls,[1,2]);assert.deepEqual([...s.done],['vip:1']);
 s.fail=0;assert.equal(await mod.exports.restoreDuoVipsOnce({}),true);assert.deepEqual(s.calls,[1,2,2]);assert.ok(s.done.has('complete'));
 assert.equal(await mod.exports.restoreDuoVipsOnce({}),true);assert.deepEqual(s.calls,[1,2,2]);
});
