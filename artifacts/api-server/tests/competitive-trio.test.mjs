import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import express from 'express';
const pg=new PGlite();
const state=globalThis.__competitive={commands:[],db:drizzle(pg),pool:{query:async text=>{await pg.exec(text);return {rows:[]}}}};
const schema=new URL('../../../lib/db/src/schema/playerStats.ts',import.meta.url).pathname;
const built=await build({stdin:{contents:'export {default as leaderboardRouter} from "./src/routes/leaderboardV2.ts";export {default as adminSeasonRouter} from "./src/admin/routesSeasonCurrentRegistrations.ts";export {default as auditRouter} from "./src/routes/seasonAudit.ts";export {default as transportRouter} from "./src/routes/seasonTransport.ts";export {default as seasonRouter,ensureSeasonIngestionTables} from "./src/routes/seasonIngestionSafe.ts";export * from "./src/core/seasonScores.ts";export * from "./src/core/eventSource.ts";export * from "./src/core/adminServerContext.ts";export * from "./src/core/competitiveStore.ts";export * from "./src/bot/killTracker.ts";export * from "./src/core/leaderboardReset.ts";export * from "./src/core/readCache.ts";export * from "./src/bot/season2GameRankSync.ts";export * from "'+schema+'";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,packages:'external',plugins:[{name:'adapters',setup(b){
 b.onResolve({filter:/^@workspace\/db$|lib\/logger\.js|antiCheat\.js|utils\/rcon\.js|admin\/guard\.js|^\.\/guard\.js$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='@workspace/db'?`export const db=globalThis.__competitive.db,pool=globalThis.__competitive.pool;export {playerStatsTable,trioPlayerStatsTable} from ${JSON.stringify(schema)};`:a.path.includes('guard')?'export const requireAdmin=(req,res,next)=>next();':a.path.includes('rcon')?'export const executeRconCommand=async command=>{globalThis.__competitive.commands.push(command);return "ok"};':a.path.includes('logger')?'export const logger={info(){},warn(){},error(){}};':'export const analyzeKill=async()=>{}; export const analyzeArrowHit=async()=>{};',loader:'ts',resolveDir:process.cwd()}));
}}]});
// Write beside dependencies so bundled ESM can resolve external packages.
const {writeFile,unlink}=await import('node:fs/promises');const output=new URL('./.competitive-test-bundle.mjs',import.meta.url);await writeFile(output,built.outputFiles[0].text);
const api=await import(output.href);await unlink(output);
await api.ensureSeasonIngestionTables();
await pg.exec(`CREATE TABLE season_official_registrations(season_key INT,steam_id TEXT,status TEXT,discord_name TEXT,created_at TIMESTAMPTZ DEFAULT NOW());INSERT INTO seasons(season_number,season_id,status) VALUES(2,'season-two','active');`);
const app=express();app.use(express.json());app.use(api.leaderboardRouter);app.use(api.seasonRouter);app.use(api.transportRouter);app.use("/admin-season",api.adminSeasonRouter);app.use(api.auditRouter);const server=app.listen(0);await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
process.env.SEASON_WEBHOOK_SECRET='test-shared';
after(async()=>{await new Promise(r=>server.close(r));await pg.close();delete globalThis.__competitive;});
const id='76561190000000001';
const event=(tx,delta,extra={})=>({transaction_id:tx,season_number:2,season_id:'season-two',event_type:'KILL',category:'pvp',base_value:delta,final_value:delta,timestamp_unix:Math.floor(Date.now()/1000),player:{steam_id:id,player_name:'Player',mmr:99999},...extra});
async function send(source,events,secret='test-shared'){const res=await fetch(base+'/season/events',{method:'POST',headers:{'content-type':'application/json','x-gf-season-secret':secret,'X-GF-Server':source},body:JSON.stringify({events})});return {status:res.status,body:await res.json()};}
test('Season combines both servers once, ignoring absolute local snapshots and false headshots',async()=>{
 await pg.query('INSERT INTO season_official_registrations(season_key,steam_id,status,discord_name) VALUES(102,$1,\'active\',\'Player\')',[id]);
 const tx='aaaaaaaa-bbbb-cccc-dddd-000000000001';
 assert.equal((await send('solo-duo',[event(tx,10,{details:'headshot=false'})])).body.accepted,1);
 assert.equal((await send('trio',[event(tx,20,{details:'{"headshot":true}'})])).body.accepted,1);
 assert.equal((await send('trio',[event(tx,20)])).body.duplicates,1);
 const result=await state.db.execute(api.seasonStandingsSql(2));
 assert.equal(Number(result.rows[0].effective_mmr),1030);assert.equal(result.rows[0].kills,2);assert.equal(result.rows[0].headshots,1);
 assert.equal((await pg.query('SELECT mmr FROM season_players')).rows[0].mmr,1030);
});
test('invalid server, credentials, origin mismatch and nonfinite score cannot affect standings',async()=>{
 assert.equal((await send('unknown',[event('aaaaaaaa-bbbb-cccc-dddd-000000000002',10)])).status,400);
 assert.equal((await send('trio',[event('aaaaaaaa-bbbb-cccc-dddd-000000000002',10)],'wrong')).status,401);
 assert.equal((await send('trio',[event('aaaaaaaa-bbbb-cccc-dddd-000000000002',10,{server_id:'solo-duo'})])).body.rejected,1);
 assert.equal((await send('trio',[event('aaaaaaaa-bbbb-cccc-dddd-000000000002','NaN')])).body.rejected,1);
 assert.equal(Number((await state.db.execute(api.seasonStandingsSql(2))).rows[0].effective_mmr),1030);
});
test('failed player update rolls back receipt, allowing a successful retry',async()=>{
 await pg.exec(`ALTER TABLE season_players ADD CONSTRAINT reject_bad_name CHECK(player_name<>'FAIL')`);
 const ev=event('aaaaaaaa-bbbb-cccc-dddd-000000000003',5);ev.player.player_name='FAIL';
 assert.equal((await send('trio',[ev])).status,500);
 assert.equal((await pg.query("SELECT COUNT(*)::int n FROM season_transactions WHERE transaction_id LIKE '%000000000003'")).rows[0].n,0);
 ev.player.player_name='Recovered';assert.equal((await send('trio',[ev])).body.accepted,1);
});
test('wipe leaderboard and receipts isolate Duo and Trio; Trio reset preserves Duo',async()=>{
 const {readFile}=await import('node:fs/promises');const init=await readFile(new URL('../../../lib/db/init-db.mjs',import.meta.url),'utf8');
 await pg.exec(init.match(/`(CREATE TABLE IF NOT EXISTS player_stats[^`]+)`/)[1]);await api.ensureCompetitiveStore();
 const killer=id,victim='76561190000000002',ev={event_id:'bbbbbbbb-cccc-dddd-eeee-000000000001',event:'kill',attacker_steamid:killer,victim_steamid:victim,attacker:'Killer',victim:'Victim',headshot:true};
 assert.equal(await api.ingestUniqueLeaderboardEvent(ev),'accepted');
 assert.equal(await api.withAdminServer('trio',()=>api.ingestUniqueLeaderboardEvent(ev)),'accepted');
 assert.equal(await api.withAdminServer('trio',()=>api.ingestUniqueLeaderboardEvent(ev)),'duplicate');
 const gather={event_id:'bbbbbbbb-cccc-dddd-eeee-000000000002',event:'gather',steamid:killer,player:'Killer',item:'wood',amount:100};
 assert.equal(await api.withAdminServer('trio',()=>api.ingestUniqueLeaderboardEvent(gather)),'accepted');
 assert.equal((await pg.query('SELECT kills,wood_gathered FROM player_stats WHERE steam_id=$1',[killer])).rows[0].wood_gathered,0);
 assert.equal((await pg.query('SELECT kills,wood_gathered FROM trio_player_stats WHERE steam_id=$1',[killer])).rows[0].wood_gathered,100);
 await api.withAdminServer('trio',()=>api.resetAllLeaderboardStats());
 assert.equal((await pg.query('SELECT kills FROM player_stats WHERE steam_id=$1',[killer])).rows[0].kills,1);
 assert.equal((await pg.query('SELECT COUNT(*)::int n FROM trio_player_stats')).rows[0].n,0);
});
test('shared Season score applies and persists ranks independently on both servers',async()=>{
 process.env.TRIO_RCON_HOST='test-trio';
 await api.syncSeason2GameRanksOnce();
 const rows=(await pg.query('SELECT server_id,steam_id,current_group,active FROM season_server_game_rank_state ORDER BY server_id')).rows;
 assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.server_id),['solo-duo','trio']);assert.ok(rows.every(r=>r.steam_id===id&&r.active&&r.current_group==='season2_soldado1'),JSON.stringify(rows));
 assert.equal(state.commands.filter(c=>c===`chat user add ${id} season2_soldado1`).length,2);
 state.commands=[];await api.syncSeason2GameRanksOnce();assert.equal(state.commands.filter(c=>c.startsWith('chat user add')).length,0);
 delete process.env.TRIO_RCON_HOST;
});
test('Trio bootstrap restores the shared ledger score instead of a server snapshot',async()=>{
 await pg.query('UPDATE season_players SET mmr=99999 WHERE steam_id=$1',[id]);
 const response=await fetch(base+'/season/bootstrap?season_number=2',{headers:{'x-gf-season-secret':'test-shared','X-GF-Server':'trio'}});assert.equal(response.status,200);const body=await response.json();assert.equal(body.players[0].mmr,1035);
});
test('admin standings and audit use the same cross-server score as the public Season',async()=>{
 await pg.exec(`ALTER TABLE season_official_registrations ADD COLUMN discord_id TEXT DEFAULT '123';ALTER TABLE season_official_registrations ADD COLUMN full_name TEXT;ALTER TABLE season_official_registrations ADD COLUMN contact_email TEXT;ALTER TABLE season_official_registrations ADD COLUMN prize_pix_type TEXT;ALTER TABLE season_official_registrations ADD COLUMN prize_pix_key TEXT;ALTER TABLE season_official_registrations ADD COLUMN paid_at TIMESTAMPTZ;`);
 const res=await fetch(base+'/admin-season/registrations');assert.equal(res.status,200);const data=await res.json();assert.equal(data.registrations[0].mmr,1035);
 const audit=await fetch(base+'/season/2/player/'+id+'/audit');assert.equal(audit.status,200);const body=await audit.json();assert.equal(body.player.mmr,1035);
});
test('dedicated Trio keys cannot authenticate as Duo; old leaderboard Season key remains compatible',()=>{
 process.env.LEADERBOARD_WEBHOOK_SECRET='leaderboard-only';process.env.TRIO_SEASON_WEBHOOK_SECRET='trio-only';
 const request=(secret,source)=>({get:key=>key.toLowerCase().includes('secret')?secret:key==='X-GF-Server'?source:undefined,query:{},body:{}});
 assert.equal(api.authenticatedEventServer(request('test-shared','solo-duo'),'leaderboard'),'solo-duo');
 assert.equal(api.authenticatedEventServer(request('trio-only',undefined),'season'),'trio');
 assert.throws(()=>api.authenticatedEventServer(request('trio-only','solo-duo'),'season'),/inválida/);
 assert.throws(()=>api.authenticatedEventServer(request('test-shared','trio'),'season'),/inválida/);
 delete process.env.LEADERBOARD_WEBHOOK_SECRET;delete process.env.TRIO_SEASON_WEBHOOK_SECRET;
});
test('public leaderboard API selects the server and rejects unknown selections',async()=>{
 const duo=await (await fetch(base+'/leaderboard?server=solo-duo')).json(),trio=await (await fetch(base+'/leaderboard?server=trio')).json();
 assert.equal(duo.serverId,'solo-duo');assert.equal(trio.serverId,'trio');assert.equal(duo.categories.kills[0].value,1);assert.equal(trio.categories.kills.length,0);
 assert.equal((await fetch(base+'/leaderboard?server=invalid')).status,400);
});
test('new map clears every Trio statistic and cached summary; heartbeat/restart preserves the same wipe',async()=>{
 const now=Date.now(),oldMap=now-86400000,newMap=now+20;let seq=10;
 const unique=()=>`cccccccc-dddd-eeee-ffff-${String(seq++).padStart(12,'0')}`;
 const send=ev=>api.withAdminServer('trio',()=>api.ingestUniqueLeaderboardEvent({event_id:unique(),timestamp:now+40,wipe_started_at:oldMap,...ev}));
 assert.equal(await send({event:'ready'}),'accepted');
 assert.equal(await send({event:'kill',attacker_steamid:id,victim_steamid:'76561190000000002',attacker:'New',victim:'Other',headshot:true}),'accepted');
 assert.equal(await send({event:'gather',steamid:id,player:'New',item:'wood',amount:50}),'accepted');
 assert.equal(await send({event:'raid_use',steamid:id,player:'New',item:'c4',amount:2}),'accepted');
 api.clearReadCache();
 const before=await (await fetch(base+'/leaderboard?server=trio')).json();assert.equal(before.summary.totalKills,1);assert.equal(before.summary.totalFarm,50);assert.equal(before.summary.totalRaid,2);
 assert.equal(await send({event:'ready',wipe_started_at:newMap}),'accepted');
 const empty=await (await fetch(base+'/leaderboard?server=trio')).json();assert.equal(empty.summary.activePlayers,0);assert.equal(empty.summary.totalKills,0);assert.equal(empty.summary.totalFarm,0);assert.equal(empty.summary.totalRaid,0);assert.equal(empty.summary.leader,null);
 assert.equal(await send({event:'gather',wipe_started_at:newMap,steamid:id,player:'New',item:'stones',amount:60}),'accepted');
 assert.equal(await send({event:'ready',wipe_started_at:newMap}),'accepted');
 assert.equal((await pg.query('SELECT stone_gathered FROM trio_player_stats')).rows[0].stone_gathered,60);
 assert.equal(await send({event:'gather',steamid:id,player:'Old map',item:'wood',amount:99999}),'rejected');
 assert.equal(await send({event:'gather',wipe_started_at:newMap, timestamp:now-100,steamid:id,player:'Old timestamp',item:'wood',amount:99999}),'rejected');
 assert.equal((await pg.query('SELECT kills FROM player_stats WHERE steam_id=$1',[id])).rows[0].kills,1);
});
test('manual reset removes all rows and rejects late pre-reset events without erasing Season',async()=>{
 const ev={event_id:'dddddddd-eeee-ffff-aaaa-000000000001',event:'gather',steamid:id,player:'Late',item:'wood',amount:100,timestamp:Date.now()-1000};
 await api.resetAllLeaderboardStats();assert.equal((await pg.query('SELECT COUNT(*)::int n FROM player_stats')).rows[0].n,0);
 assert.equal(await api.ingestUniqueLeaderboardEvent(ev),'rejected');
 assert.equal(Number((await state.db.execute(api.seasonStandingsSql(2))).rows[0].effective_mmr),1035);
});

test('a plugin package installed on the wrong server cannot modify its leaderboard',async()=>{
 assert.equal(await api.ingestUniqueLeaderboardEvent({event_id:'eeeeeeee-ffff-aaaa-bbbb-000000000001',server_id:'trio',event:'ready',timestamp:Date.now()}),'rejected');
});
