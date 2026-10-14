import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const state=globalThis.__boosterServers={commands:[],updated:[],boosting:true,discordError:false,trioFailed:false};
const result=await build({entryPoints:['src/bot/booster.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'mocks',setup(p){
 p.onLoad({filter:/\/booster\.ts$/},a=>({contents:readFileSync(a.path,'utf8')+'\nexport { syncOne, syncBoosterServers };',loader:'ts'}));
 p.onResolve({filter:/^@workspace\/db$|serverRcon\.js$|lib\/logger\.js$/},a=>({path:a.path,namespace:'mock'}));
 p.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='@workspace/db'
 ? 'export const boosterLinksTable={discordUserId:"id"};export const db={update:()=>({set:value=>({where:async()=>globalThis.__boosterServers.updated.push(value)})})};'
 :a.path.includes('serverRcon')?'export const executeServerRcon=async(server,command)=>{const s=globalThis.__boosterServers;s.commands.push({server,command});return server==="trio"&&s.trioFailed?null:"ok";};'
 :'export const logger={info(){},error(){}};'}));
}}]});
const mod={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
process.env.DISCORD_GUILD_ID='guild';
const client={guilds:{fetch:async()=>({members:{fetch:async()=>{if(state.discordError)throw Error('Discord unavailable');return {premiumSince:state.boosting?new Date():null};}}})}};
const steam='76561199653021937';
test('existing verified active boosters are granted to both game servers, with retry after Trio failure',async()=>{
 state.trioFailed=true;
 await assert.rejects(mod.exports.syncOne(client,'discord',steam,true,false),/restauração/);
 assert.deepEqual(state.commands.map(x=>x.server),['solo-duo','trio']);
 assert.ok(state.commands.every(x=>x.command===`c.usergroup add ${steam} bs`));
 assert.equal(state.updated.length,0);
 state.trioFailed=false;state.commands=[];
 await mod.exports.syncOne(client,'discord',steam,true,false);
 assert.equal(state.commands.length,2);
});
test('inactive links are not granted, disabled links are removed, and Discord outages do not revoke',async()=>{
 state.commands=[];
 await mod.exports.syncOne(client,'discord',steam,false,false);
 await mod.exports.syncOne(client,'discord',steam,true,true);
 assert.equal(state.commands.length,2);
 assert.ok(state.commands.every(x=>x.command.includes('remove')));
 state.commands=[];
 state.discordError=true;
 await assert.rejects(mod.exports.syncOne(client,'discord',steam,true,false));
 state.discordError=false;
 assert.equal(state.commands.length,0);
});
test('ended boost is removed on both servers before deactivating the shared link',async()=>{
 state.boosting=false;state.trioFailed=true;state.commands=[];
 await assert.rejects(mod.exports.syncOne(client,'discord',steam,true,false),/remoção/);
 assert.equal(state.updated.length,0);
 state.trioFailed=false;state.commands=[];
 await mod.exports.syncOne(client,'discord',steam,true,false);
 assert.deepEqual(state.commands.map(x=>x.server),['solo-duo','trio']);
 assert.ok(state.commands.every(x=>x.command===`c.usergroup remove ${steam} bs`));
 assert.equal(state.updated[0].active,false);
});
