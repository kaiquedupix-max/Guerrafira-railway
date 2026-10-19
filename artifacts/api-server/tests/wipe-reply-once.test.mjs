import {test,after} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {PGlite} from '@electric-sql/pglite';import {createRequire} from 'node:module';
const pg=new PGlite();globalThis.__replyPool={query:(...args)=>pg.query(...args)};
const result=await build({entryPoints:['src/bot/moderation.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'reply-adapters',setup(b){b.onResolve({filter:/^@workspace\/db$|lib\/logger\.js/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='@workspace/db'?'export const pool=globalThis.__replyPool,db={},vipSubscriptionsTable={};':'export const logger={info(){},warn(){},error(){}};'}));}}]});
const mod={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);const api=mod.exports;
after(async()=>{await pg.close();delete globalThis.__replyPool;});
const message=(id,content,reply)=>({id,content,author:{bot:false},guild:{id:'guild'},channelId:'general',reply});
test('concurrent handlers and later replay produce only one response to one Discord message',async()=>{
 let sent=0;const msg=message('100000000000000001','quando é wipe?',async payload=>{assert.equal(payload.nonce,'100000000000000001');assert.equal(payload.enforceNonce,true);sent++;});
 await Promise.all([api.handleWipeReply(msg),api.handleWipeReply(msg)]);await api.handleWipeReply(msg);assert.equal(sent,1);
});
test('failed send can retry, but announcements are ignored',async()=>{
 let sent=0,fail=true;const msg=message('100000000000000002','wipe hoje?',async()=>{if(fail)throw Error('Discord unavailable');sent++;});await assert.rejects(api.handleWipeReply(msg));fail=false;await api.handleWipeReply(msg);assert.equal(sent,1);
 await api.handleWipeReply(message('100000000000000003','@everyone NOVIDADES! Leaderboard do Trio a partir do próximo wipe.',async()=>sent++));assert.equal(sent,1);
});
test('moderation listeners are installed only once for the same client',()=>{let on=0,once=0;const client={on(){on++},once(){once++}};api.startDiscordModeration(client);api.startDiscordModeration(client);assert.equal(on,1);assert.equal(once,1);});
