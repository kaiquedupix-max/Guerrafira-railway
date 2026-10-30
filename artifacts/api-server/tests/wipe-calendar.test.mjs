import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const built = await build({ entryPoints: ['src/core/wipeCalendar.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
test('Trio Wednesday 18:30 Brasilia', () => {
 const s=api.datedWipeSchedule('trio','2026-11-04');
 assert.equal(new Date(s.publicWipeAt).toISOString(),'2026-11-04T21:30:00.000Z');
 assert.equal(new Date(s.voteEndsAt).toISOString(),'2026-11-04T21:00:00.000Z');
 assert.equal(new Date(s.wipeAt).toISOString(),'2026-11-04T21:25:00.000Z');
});
test('Trio Sunday 13:00 Brasilia, no Saturday wipe', () => {
 const s=api.datedWipeSchedule('trio','2026-11-01');
 assert.equal(new Date(s.publicWipeAt).toISOString(),'2026-11-01T16:00:00.000Z');
 assert.equal(new Date(s.voteEndsAt).toISOString(),'2026-11-01T15:30:00.000Z');
 assert.equal(new Date(s.wipeAt).toISOString(),'2026-11-01T15:55:00.000Z');
 assert.deepEqual(api.wipeCalendar('trio').days,[3,0]);
 assert.equal(api.wipeScheduleLabel('trio'),'quarta-feira às 18h30 e domingo às 13h00 (Brasília)');
 assert.throws(()=>api.datedWipeSchedule('trio','2026-10-31'),/quarta-feira às 18h30 e domingo às 13h00/);
});
test('Next Trio wipe Sunday 13:00 then Wednesday 18:30',()=>{
 assert.equal(new Date(api.serverWipeWindow('trio',new Date('2026-10-30T20:00:00Z')).next).toISOString(),'2026-11-01T16:00:00.000Z');
 assert.equal(new Date(api.serverWipeWindow('trio',new Date('2026-11-01T16:00:01Z')).next).toISOString(),'2026-11-04T21:30:00.000Z');
});
test('Duo remains Monday and Friday 18:30',()=>{
 assert.deepEqual(api.wipeCalendar('solo-duo').days,[1,5]);
 const s=api.datedWipeSchedule('solo-duo','2026-10-30');
 assert.equal(new Date(s.publicWipeAt).toISOString(),'2026-10-30T21:30:00.000Z');
 assert.equal(new Date(s.voteEndsAt).toISOString(),'2026-10-30T21:00:00.000Z');
 assert.equal(new Date(s.wipeAt).toISOString(),'2026-10-30T21:25:00.000Z');
});
