import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const state=globalThis.__slotPresence={mode:'automatic',writes:0,timers:[]};
const output=await build({entryPoints:['src/bot/slotManager.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'adapters',setup(p){
 p.onResolve({filter:/^@workspace\/db$|utils\/rcon\.js$|lib\/logger\.js$/},a=>({path:a.path,namespace:'mock'}));
 p.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='@workspace/db'?'export const pool={query:async sql=>({rows:sql.includes("SELECT mode")?[{mode:globalThis.__slotPresence.mode,min_slots:180,max_slots:250,manual_slots:180}]:[]})};':a.path.includes('rcon')?'export const getServerInfo=async()=>({players:68,maxPlayers:180,queued:0});export const executeRconCommand=async()=>null;':'export const logger={info(){},error(){}};'}));
}}]});
const mod={exports:{}};new Function('require','module','exports','setTimeout','setInterval',output.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports,fn=>state.timers.push(fn),fn=>state.timers.push(fn));
mod.exports.startSlotManager({user:{setPresence:()=>state.writes++}});
test('automatic and manual slot-manager ticks never overwrite aggregate Discord presence',async()=>{for(const mode of ['automatic','manual']){state.mode=mode;await state.timers[0]();}assert.equal(state.writes,0);});
