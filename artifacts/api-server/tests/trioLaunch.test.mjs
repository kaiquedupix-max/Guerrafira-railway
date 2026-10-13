import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
process.env.TZ = 'UTC';

const database = new PGlite();
await database.exec(`CREATE TABLE vip_subscriptions(id integer, source text, created_at timestamp, starts_at timestamp, expires_at timestamp, duration_days integer, game_vip_removed boolean);
CREATE TABLE store_orders(payment_id integer, server_id text);
INSERT INTO store_orders VALUES(1,'trio'),(2,'solo-duo');
INSERT INTO vip_subscriptions VALUES
(1,'purchase:1','2026-10-01','2026-10-01','2026-10-31',30,false),
(2,'purchase:2','2026-10-01','2026-10-01','2026-10-31',30,false),
(3,'purchase:3:trio','2026-10-01','2026-10-01','2026-10-31',30,false),
(4,'purchase:4:solo-duo','2026-10-01','2026-10-01','2026-10-31',30,false),
(5,'purchase:5:trio','2026-10-15','2026-10-15','2026-11-14',30,false),
(7,'manual:trio','2026-10-13','2026-10-13','2026-11-12',30,false),
(8,'purchase:8:trio','2026-10-14 03:00','2026-10-14 03:00','2026-11-13 03:00',30,false),
(6,'purchase:6:trio','2026-10-01','2026-10-01','2026-10-02',30,true);`);
globalThis.__launchDb = database;
const result = await build({entryPoints:['src/bot/trioLaunch.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'mock',setup(p){
  p.onResolve({filter:/^@workspace\/db$|storeOrders\.js$/},a=>({path:a.path,namespace:'mock'}));
  p.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='@workspace/db'?'export const pool=globalThis.__launchDb;':'export async function ensureStoreOrders(){}'}));
}}]});
const mod={exports:{}};
new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const {vipStartsAt,repairTrioPrelaunchVips,TRIO_LAUNCH_AT}=mod.exports;
test('Trio prelaunch clock starts on launch day; Duo and later purchases retain their dates',()=>{
  const early=new Date('2026-10-11T12:00:00Z'),late=new Date('2026-10-15T12:00:00Z');
  assert.equal(vipStartsAt('trio',early).getTime(),TRIO_LAUNCH_AT.getTime());
  assert.equal(vipStartsAt('solo-duo',early),early);
  assert.equal(vipStartsAt('trio',late),late);
  assert.equal(vipStartsAt('trio',new Date('2026-10-14T20:00:00Z')).toISOString(),'2026-10-14T21:30:00.000Z');
  assert.equal(new Date(TRIO_LAUNCH_AT.getTime()+30*86400000).toISOString(),'2026-11-13T21:30:00.000Z');
});
test('repair moves only active prelaunch Trio subscriptions and is idempotent',async()=>{
  await repairTrioPrelaunchVips();
  const first=(await database.query('SELECT * FROM vip_subscriptions ORDER BY id')).rows;
  for(const i of [0,2,6,7]){
    assert.equal(first[i].starts_at.toISOString(),'2026-10-14T21:30:00.000Z');
    assert.equal(first[i].expires_at-first[i].starts_at,30*86400000);
  }
  assert.equal(first[1].starts_at.toISOString(),'2026-10-01T00:00:00.000Z');
  assert.equal(first[3].starts_at.toISOString(),'2026-10-01T00:00:00.000Z');
  assert.equal(first[4].starts_at.toISOString(),'2026-10-15T00:00:00.000Z');
  assert.equal(first[5].game_vip_removed,true);
  await repairTrioPrelaunchVips();
  assert.deepEqual((await database.query('SELECT * FROM vip_subscriptions ORDER BY id')).rows,first);
  await database.close();
});
