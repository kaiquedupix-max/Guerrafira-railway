import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({entryPoints:['src/core/wipeCalendar.ts'],bundle:true,platform:'node',format:'esm',write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('Sunday October 18 vote uses Brasilia 13:00 and correct voting/execution deadlines',()=>{
 const schedule=api.datedWipeSchedule('trio','2026-10-18');
 assert.equal(new Date(schedule.publicWipeAt).toISOString(),'2026-10-18T16:00:00.000Z');
 assert.equal(new Date(schedule.voteEndsAt).toISOString(),'2026-10-18T15:30:00.000Z');
 assert.equal(new Date(schedule.wipeAt).toISOString(),'2026-10-18T15:55:00.000Z');
});
test('legacy environment days cannot override the Wednesday/Sunday schedule',()=>{
 const previous=process.env.TRIO_WIPE_DAYS;
 try{for(const old of ['3','3,0','']){process.env.TRIO_WIPE_DAYS=old;assert.deepEqual(api.wipeCalendar('trio').days,[3,0]);assert.doesNotThrow(()=>api.datedWipeSchedule('trio','2026-10-18'));assert.doesNotThrow(()=>api.datedWipeSchedule('trio','2026-10-21'));assert.throws(()=>api.datedWipeSchedule('trio','2026-10-17'),/quarta-feira às 18h00 e domingo às 13h00/);}}
 finally{if(previous===undefined)delete process.env.TRIO_WIPE_DAYS;else process.env.TRIO_WIPE_DAYS=previous;}
});
test('next wipe advances from Sunday to Wednesday, with date boundaries in Brasilia',()=>{
 assert.equal(new Date(api.serverWipeWindow('trio',new Date('2026-10-17T12:06:00Z')).next).toISOString(),'2026-10-18T16:00:00.000Z');
 assert.equal(new Date(api.serverWipeWindow('trio',new Date('2026-10-18T16:00:01Z')).next).toISOString(),'2026-10-21T21:00:00.000Z');
 assert.equal(api.localWipeDate(new Date('2026-10-18T01:00:00Z')),'2026-10-17');
});
test('Duo keeps Monday and Friday; impossible dates remain rejected',()=>{
 assert.deepEqual(api.wipeCalendar('solo-duo').days,[1,5]);
 assert.doesNotThrow(()=>api.datedWipeSchedule('solo-duo','2026-10-19'));assert.doesNotThrow(()=>api.datedWipeSchedule('solo-duo','2026-10-23'));
 assert.throws(()=>api.datedWipeSchedule('solo-duo','2026-10-18'),/segunda-feira e sexta-feira/);
 assert.throws(()=>api.datedWipeSchedule('trio','2026-02-30'),/Data inválida/);
});

test('Wednesday Trio deadlines and Duo clock remain correct despite stale environment',()=>{
 const oldHour=process.env.TRIO_WIPE_HOUR,oldMinute=process.env.TRIO_WIPE_MINUTE;
 try{process.env.TRIO_WIPE_HOUR='18';process.env.TRIO_WIPE_MINUTE='30';
 const w=api.datedWipeSchedule('trio','2026-10-21');
 assert.equal(new Date(w.publicWipeAt).toISOString(),'2026-10-21T21:00:00.000Z');
 assert.equal(new Date(w.voteEndsAt).toISOString(),'2026-10-21T20:30:00.000Z');
 assert.equal(new Date(w.wipeAt).toISOString(),'2026-10-21T20:55:00.000Z');
 assert.equal(new Date(api.datedWipeSchedule('solo-duo','2026-10-23').publicWipeAt).toISOString(),'2026-10-23T21:30:00.000Z');
 }finally{if(oldHour===undefined)delete process.env.TRIO_WIPE_HOUR;else process.env.TRIO_WIPE_HOUR=oldHour;if(oldMinute===undefined)delete process.env.TRIO_WIPE_MINUTE;else process.env.TRIO_WIPE_MINUTE=oldMinute;}
});
