import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const built = await build({ entryPoints: ['src/core/wipeCalendar.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
test('Trio Saturday 18:00 Brasilia', () => {
 const s=api.datedWipeSchedule('trio','2026-11-07');
 assert.equal(new Date(s.publicWipeAt).toISOString(),'2026-11-07T21:00:00.000Z');
 assert.equal(new Date(s.voteEndsAt).toISOString(),'2026-11-07T20:30:00.000Z');
 assert.equal(new Date(s.wipeAt).toISOString(),'2026-11-07T20:55:00.000Z');
 assert.deepEqual(api.wipeCalendar('trio').days,[6]);
 assert.equal(api.wipeScheduleLabel('trio'),'sábado às 18h00 (Brasília)');
 assert.throws(()=>api.datedWipeSchedule('trio','2026-11-08'),/sábado às 18h00/);
});
test('Next Trio wipe is Saturday at 18:00',()=>{
 assert.equal(new Date(api.serverWipeWindow('trio',new Date('2026-11-06T20:00:00Z')).next).toISOString(),'2026-11-07T21:00:00.000Z');
 assert.equal(new Date(api.serverWipeWindow('trio',new Date('2026-11-07T21:00:01Z')).next).toISOString(),'2026-11-14T21:00:00.000Z');
});
test('UTC Sunday still uses the Sao Paulo Saturday date after Saturday wipe time',()=>{
 assert.equal(api.localWipeDate(new Date('2026-11-08T01:00:00Z')),'2026-11-07');
 assert.equal(new Date(api.serverWipeWindow('trio',new Date('2026-11-08T01:00:00Z')).next).toISOString(),'2026-11-14T21:00:00.000Z');
});
test('Duo remains Monday and Friday 18:30',()=>{
 assert.deepEqual(api.wipeCalendar('solo-duo').days,[1,5]);
 const s=api.datedWipeSchedule('solo-duo','2026-10-30');
 assert.equal(new Date(s.publicWipeAt).toISOString(),'2026-10-30T21:30:00.000Z');
 assert.equal(new Date(s.voteEndsAt).toISOString(),'2026-10-30T21:00:00.000Z');
 assert.equal(new Date(s.wipeAt).toISOString(),'2026-10-30T21:25:00.000Z');
});
