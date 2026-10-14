import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const state = globalThis.__slotServers = {
  db, timers: [], commands: [],
  info: {
    'solo-duo': { players: 20, maxPlayers: 100, queued: 0 },
    trio: { players: 2, maxPlayers: 5, queued: 0 },
  },
};
const built = await build({entryPoints:['src/bot/slotManager.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'mocks',setup(p){
  p.onLoad({filter:/slotManager\.ts$/},a=>({contents:readFileSync(a.path,'utf8')+'\nexport {adminServer, withAdminServer};',loader:'ts'}));
  p.onResolve({filter:/^@workspace\/db$|utils\/rcon\.js$|lib\/logger\.js$/},a=>({path:a.path,namespace:'mock'}));
  p.onLoad({filter:/.*/,namespace:'mock'},a=>({resolveDir:process.cwd(),contents:a.path==='@workspace/db'
    ? 'export const pool={query:(sql,args)=>globalThis.__slotServers.db.query(sql,args)};'
    : a.path.includes('rcon')
      ? `import {adminServer} from ${JSON.stringify(new URL('../src/core/adminServerContext.ts',import.meta.url).pathname)};
         export const getServerInfo=async()=>({...globalThis.__slotServers.info[adminServer()]});
         export const executeRconCommand=async command=>{const s=globalThis.__slotServers;const server=adminServer();s.commands.push({server,command});s.info[server].maxPlayers=Number(command.split(' ')[1]);return 'ok';};`
      : 'export const logger={info(){},error(){}};'}));
}}]});
const mod={exports:{}};
new Function('require','module','exports','setTimeout','setInterval',built.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports,
  (fn,ms)=>ms===500||ms===700||ms===1400?fn():state.timers.push(fn),fn=>state.timers.push(fn));
const slots=mod.exports;
slots.startSlotManager({});
const settings=server=>slots.withAdminServer(server,()=>slots.getSlotControlSettings());
const save=(server,input)=>slots.withAdminServer(server,()=>slots.updateSlotControlSettings(input));

test('independent settings and RCON targets survive simultaneous requests and background cycles',async()=>{
  await db.exec(`CREATE TABLE server_slot_settings(id INTEGER PRIMARY KEY,mode TEXT NOT NULL,min_slots INTEGER NOT NULL,max_slots INTEGER NOT NULL,manual_slots INTEGER NOT NULL,updated_by TEXT,updated_at TIMESTAMPTZ DEFAULT NOW());
    INSERT INTO server_slot_settings(id,mode,min_slots,max_slots,manual_slots) VALUES(1,'manual',100,250,100);`);
  assert.equal((await settings('trio')).manualSlots,5);
  assert.equal((await settings('solo-duo')).manualSlots,100);
  await state.timers[0]();
  assert.deepEqual(state.commands,[],'unconfigured Trio must keep its current 5 slots');
  const result=await save('trio',{mode:'manual',minSlots:5,maxSlots:80,manualSlots:10});
  assert.equal(result.applied,true);
  assert.deepEqual(state.commands,[{server:'trio',command:'server.maxplayers 10'}]);
  assert.equal((await settings('solo-duo')).manualSlots,100);
  await Promise.all([
    save('solo-duo',{mode:'manual',minSlots:100,maxSlots:250,manualSlots:120}),
    save('trio',{mode:'automatic',minSlots:5,maxSlots:15,manualSlots:10}),
  ]);
  state.info.trio.queued=5;
  await state.timers[1]();
  assert.equal(state.info.trio.maxPlayers,15);
  assert.equal(state.info['solo-duo'].maxPlayers,120);
  await state.timers[1]();
  assert.equal(state.info.trio.maxPlayers,15,'automatic expansion respects Trio maximum');
  state.info.trio.queued=0;
  await state.timers[1]();
  assert.equal(state.info.trio.maxPlayers,10);
  await assert.rejects(save('trio',{mode:'manual',minSlots:1,maxSlots:15,manualSlots:1}),/jogadores online/);
  assert.equal((await settings('trio')).mode,'automatic');
  assert.equal((await settings('solo-duo')).mode,'manual');
  assert.equal(slots.adminServer(),'solo-duo');
  await db.close();
});
