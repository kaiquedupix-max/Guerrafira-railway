import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({entryPoints:['src/core/wipeCalendar.ts'],bundle:true,platform:'node',format:'esm',write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

test('Trio Wednesday and Saturday wipe officially at 18h30 Brasilia',()=>{
 for(const day of ['2026-10-28','2026-10-31']){
  const schedule=api.datedWipeSchedule('trio',day);
  assert.equal(new Date(schedule.publicWipeAt).toISOString(),day+'T21:30:00.000Z');
  assert.equal(new Date(schedule.voteEndsAt).toISOString(),day+'T21:00:00.000Z');
  assert.equal(new Date(schedule.wipeAt).toISOString(),day+'T21:25:00.000Z');
 }
 assert.deepEqual(api.wipeCalendar('trio').days,[3,6]);
 assert.equal(api.wipeScheduleLabel('trio'),'quarta-feira e sábado às 18h30 (Brasília)');
 assert.throws(()=>api.datedWipeSchedule('trio','2026-11-01'),/quarta-feira e sábado/);
});

test('next Trio wipe Saturday then Wednesday without 18h early execution',()=>{
 assert.equal(new Date(api.serverWipeWindow('trio',new Date('2026-10-30T20:00:00Z')).next).toISOString(),'2026-10-31T21:30:00.000Z');
 assert.equal(new Date(api.serverWipeWindow('trio',new Date('2026-10-31T21:30:01Z')).next).toISOString(),'2026-11-04T21:30:00.000Z');
});

test('Duo remains Monday/Friday 18h30',()=>{
 assert.deepEqual(api.wipeCalendar('solo-duo').days,[1,5]);
 const schedule=api.datedWipeSchedule('solo-duo','2026-10-30');
 assert.equal(new Date(schedule.publicWipeAt).toISOString(),'2026-10-30T21:30:00.000Z');
 assert.equal(new Date(schedule.voteEndsAt).toISOString(),'2026-10-30T21:00:00.000Z');
 assert.equal(new Date(schedule.wipeAt).toISOString(),'2026-10-30T21:25:00.000Z');
});
