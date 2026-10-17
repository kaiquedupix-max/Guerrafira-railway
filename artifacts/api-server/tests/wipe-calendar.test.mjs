import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({entryPoints:['src/core/wipeCalendar.ts'],bundle:true,platform:'node',format:'esm',write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('Saturday October 17 vote uses Brasilia 18:30 and correct voting/execution deadlines',()=>{
 const schedule=api.datedWipeSchedule('trio','2026-10-17');
 assert.equal(new Date(schedule.publicWipeAt).toISOString(),'2026-10-17T21:30:00.000Z');
 assert.equal(new Date(schedule.voteEndsAt).toISOString(),'2026-10-17T21:00:00.000Z');
 assert.equal(new Date(schedule.wipeAt).toISOString(),'2026-10-17T21:25:00.000Z');
});
test('legacy Wednesday-only or Wednesday/Sunday settings cannot block the correct Saturday schedule',()=>{
 const previous=process.env.TRIO_WIPE_DAYS;
 try{for(const old of ['3','3,0','']){process.env.TRIO_WIPE_DAYS=old;assert.deepEqual(api.wipeCalendar('trio').days,[3,6]);assert.doesNotThrow(()=>api.datedWipeSchedule('trio','2026-10-17'));assert.doesNotThrow(()=>api.datedWipeSchedule('trio','2026-10-21'));assert.throws(()=>api.datedWipeSchedule('trio','2026-10-18'),/quarta-feira e sábado/);}}
 finally{if(previous===undefined)delete process.env.TRIO_WIPE_DAYS;else process.env.TRIO_WIPE_DAYS=previous;}
});
test('next wipe advances from Saturday to Wednesday, with date boundaries in Brasilia',()=>{
 assert.equal(new Date(api.serverWipeWindow('trio',new Date('2026-10-17T12:06:00Z')).next).toISOString(),'2026-10-17T21:30:00.000Z');
 assert.equal(new Date(api.serverWipeWindow('trio',new Date('2026-10-17T21:30:01Z')).next).toISOString(),'2026-10-21T21:30:00.000Z');
 assert.equal(api.localWipeDate(new Date('2026-10-18T01:00:00Z')),'2026-10-17');
});
test('Duo keeps Monday and Friday; impossible dates remain rejected',()=>{
 assert.deepEqual(api.wipeCalendar('solo-duo').days,[1,5]);
 assert.doesNotThrow(()=>api.datedWipeSchedule('solo-duo','2026-10-19'));assert.doesNotThrow(()=>api.datedWipeSchedule('solo-duo','2026-10-23'));
 assert.throws(()=>api.datedWipeSchedule('solo-duo','2026-10-17'),/segunda-feira e sexta-feira/);
 assert.throws(()=>api.datedWipeSchedule('trio','2026-02-30'),/Data inválida/);
});
