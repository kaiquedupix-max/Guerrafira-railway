import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const state=globalThis.__serverTest={rows:[],hosts:[],inserted:[],notices:[]};
state.db={select(){const chain={from(){return chain;},where(){return chain;},then(yes,no){return Promise.resolve(state.rows.shift()||[]).then(yes,no);},limit:async()=>state.rows.shift()||[]};return chain;},update(){return{set(){return{where:async()=>{}}}};},insert(){return{values(row){state.inserted.push(row);return{returning:async()=>[{id:101}]};}};}};
const mocks={
 '@workspace/db':'export const db=globalThis.__serverTest.db,pool={query:async()=>({rows:[]})};export const mapVotesTable={},mapVoteBallotsTable={},vipSubscriptionsTable={},boosterLinksTable={};',
 'hostWipe.js':'const s=globalThis.__serverTest;export const diagnoseHost=async()=>{s.hosts.push(s.context());return {capabilities:{proceduralStartup:true},levelUrlVariable:"LEVEL_URL"};};export const executePreparedProceduralWipe=async()=>s.hosts.push(s.context()),executePreparedWipe=async()=>s.hosts.push(s.context()),prepareProceduralWipeBackup=async()=>"backup";',
 'wipeLock.js':'export const getWipeLockState=async()=>({unlocked:true});',
 'gameAnnouncement.js':'export const sendGameAnnouncement=async()=>globalThis.__serverTest.notices.push(globalThis.__serverTest.context());',
 'logger.js':'export const logger={info(){},warn(){},error(){}};',
 'adminNotifications.js':'export const notifySubscribedAdmins=async()=>{};',
 'leaderboardChannel.js':'export const refreshLeaderboardChannel=async()=>{};',
 'serverRcon.js':'export const executeServerRcon=async()=>null;'
};
async function load(entry,extra=''){
 const output=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'mocks',setup(p){
 p.onResolve({filter:/.*/},a=>{const key=Object.keys(mocks).find(k=>a.path===k||a.path.endsWith('/'+k));if(key)return{path:key,namespace:'mock'};});
 p.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));
 if(extra)p.onLoad({filter:/criarmapa\.ts$/},a=>({contents:readFileSync(a.path,'utf8')+extra,loader:'ts'}));
 }}]});const mod={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);return mod.exports;
}
const vote=await load('src/bot/commands/criarmapa.ts','\nexport { normalizeMap, adminServer, withAdminServer, hostSettings, processScheduledWipes };');state.context=vote.adminServer;
const status=await load('src/bot/networkStatus.ts');
const calendar=await load('src/core/wipeCalendar.ts');
const connect=await load('src/core/serverConnectPage.ts');
const snapshot=(id,players)=>status.parseOnlineSnapshot(id,JSON.stringify({Players:players,MaxPlayers:200}));
test('principal status adds online Duo and Trio counts, excluding queue',()=>{
 assert.match(status.networkPresence([snapshot('solo-duo',37),snapshot('trio',21)]),/^58\/400 jogadores online/);
});
test('unavailable status is explicitly partial rather than a false total',()=>{
 assert.match(status.networkPresence([snapshot('solo-duo',37),status.parseOnlineSnapshot('trio',null)]),/^37\+\/200\+ online.*Trio indisponível/);
 assert.equal(status.parseOnlineSnapshot('trio','{}').online,false);assert.equal(status.parseOnlineSnapshot('trio','Unknown command').online,false);
 assert.equal(snapshot('trio',0).online,true);
});
test('server selection is required and persists through both map source formats',()=>{
 const option=vote.data.toJSON().options.find(o=>o.name==='servidor');assert.equal(option.required,true);assert.deepEqual(option.choices.map(c=>c.value),['solo-duo','trio']);
 for(const mode of ['seed','link'])assert.equal(vote.normalizeMap({mode,serverId:'trio',seed:1,size:3000,mapUrl:mode==='link'?'https://example.com/map.map':undefined},0).serverId,'trio');
 assert.equal(vote.normalizeMap({mode:'seed',seed:1,size:3000},0).serverId,'solo-duo');
});
test('Trio never falls back to the Duo host credentials',()=>{
 process.env.ELGAE_PANEL_URL='https://duo.invalid';process.env.ELGAE_SERVER_ID='duo-id';process.env.ELGAE_API_KEY='test-duo';delete process.env.TRIO_PANEL_URL;delete process.env.TRIO_PANEL_API_KEY;delete process.env.TRIO_PANEL_SERVER_ID;
 const config=vote.withAdminServer('trio',()=>vote.hostSettings());assert.equal(config.panelUrl,'');assert.equal(config.serverId,'');assert.equal(config.apiKey,'');
});
test('voting creation diagnoses and persists the selected Trio target',async()=>{
 process.env.TRIO_PANEL_URL='https://trio.invalid';process.env.TRIO_PANEL_SERVER_ID='trio-id';process.env.TRIO_PANEL_API_KEY='test-trio';process.env.TRIO_DISCORD_MAP_CHANNEL_ID='trio-maps';state.rows=[[]];state.hosts=[];state.inserted=[];
 const future=new Date(Date.now()+8*86400000);while(future.getUTCDay()!==3)future.setUTCDate(future.getUTCDate()+1);
 const sent=[];const message={id:'vote-trio',delete:async()=>{}};const client={channels:{fetch:async id=>id==='trio-maps'?{isSendable:()=>true,send:async payload=>{sent.push(payload);return message;}}:null}};
 const result=await vote.createMapVote(client,{serverId:'trio',createdBy:'admin',date:future.toISOString().slice(0,10),maps:[1,2,3].map(seed=>({mode:'seed',seed,size:3000}))});vote.cancelActiveMapVoteRuntime(result.messageId);
 assert.deepEqual(state.hosts,['trio']);assert.equal(state.inserted[0].channelId,'trio-maps');assert.ok(JSON.parse(state.inserted[0].mapsJson).every(m=>m.serverId==='trio'));assert.match(sent[0].embeds[0].toJSON().title,/Trio.*WIPE DE MAPA/);assert.equal(vote.adminServer(),'solo-duo');
});
test('manual execution after reload uses persisted Trio target and keeps legacy votes on Duo',async()=>{
 for(const serverId of ['trio',undefined]){
 state.hosts=[];state.rows=[[{id:102,messageId:'old',channelId:'maps',mapsJson:JSON.stringify([{mode:'link',mapUrl:'https://example.com/map.map',serverId}]),winnerIndex:0}]];
 await vote.executeSelectedMapVoteNow({channels:{fetch:async()=>null}},102,{id:'admin',name:'Admin'});assert.deepEqual(state.hosts,[serverId||'solo-duo']);assert.equal(vote.adminServer(),'solo-duo');
 }
});

test('simultaneous scheduled wipes preserve each saved target',async()=>{
 process.env.WIPE_EXECUTION_ENABLED='true';process.env.WIPE_AUTOMATION_ENABLED='true';state.hosts=[];
 const endsAt=new Date(Date.now()-25*60000),wipeAt=new Date(endsAt.getTime()+25*60000);
 const rows=['solo-duo','trio'].map((serverId,n)=>({id:200+n,endsAt,wipeAt,winnerIndex:0,mapsJson:JSON.stringify([{mode:'link',serverId,mapUrl:'https://example.com/map.map'}])}));
 state.rows=[rows,[],rows];await vote.processScheduledWipes({channels:{fetch:async()=>null}});assert.deepEqual(state.hosts.sort(),['solo-duo','trio']);assert.equal(vote.adminServer(),'solo-duo');
});
test('corrupt saved server identifiers fail closed',()=>{assert.throws(()=>vote.normalizeMap({serverId:'unknown',mode:'seed',seed:1,size:3000},0),/Servidor inválido/);});

test('aggregate presence adds the actual slots reported by both servers',()=>{
 const duo=status.parseOnlineSnapshot('solo-duo',JSON.stringify({Players:68,MaxPlayers:180,Queued:9})),trio=status.parseOnlineSnapshot('trio',JSON.stringify({Players:0,MaxPlayers:5,Queued:2}));
 assert.equal(status.networkPresence([duo,trio]),'68/185 jogadores online • Guerra Fria');
});
test('Trio wipe is Wednesday 18:30 Brasilia and Duo retains Monday and Friday',()=>{
 const trio=calendar.datedWipeSchedule('trio','2026-10-14');assert.equal(new Date(trio.publicWipeAt).toISOString(),'2026-10-14T21:30:00.000Z');assert.equal(new Date(trio.voteEndsAt).toISOString(),'2026-10-14T21:00:00.000Z');assert.equal(new Date(trio.wipeAt).toISOString(),'2026-10-14T21:25:00.000Z');
 assert.throws(()=>calendar.datedWipeSchedule('trio','2026-10-16'),/quartas/);assert.doesNotThrow(()=>calendar.datedWipeSchedule('solo-duo','2026-10-16'));
 const next=calendar.serverWipeWindow('trio',new Date('2026-10-14T21:31:00Z')).next;assert.equal(new Date(next).toISOString(),'2026-10-21T21:30:00.000Z');assert.match(calendar.wipeScheduleLabel('trio'),/quarta-feira às 18h30/);
});
test('connection pages route to their own server and reject malformed configured addresses',()=>{
 process.env.RUST_SERVER_HOST='duo.example.com';process.env.RUST_SERVER_PORT='28015';process.env.TRIO_RUST_SERVER_HOST='trio.example.com';process.env.TRIO_RUST_SERVER_PORT='28025';
 assert.match(connect.serverConnectPage('solo-duo'),/steam:\/\/connect\/duo.example.com:28015/);assert.match(connect.serverConnectPage('trio'),/steam:\/\/connect\/trio.example.com:28025/);
 process.env.TRIO_RUST_SERVER_HOST='<script>';assert.throws(()=>connect.serverConnectPage('trio'),/não configurado/);process.env.TRIO_RUST_SERVER_HOST='trio.example.com';
});
test('cleanup removes only the old status card owned by the principal bot',async()=>{
 process.env.DISCORD_STATUS_CHANNEL_ID='status';const deleted=[];
 const card=(id,author,footer)=>({id,author:{id:author},embeds:[{footer:{text:footer}}],delete:async()=>deleted.push(id)});
 const cards=new Map([['old',card('old','main','Guerra Fria • Atualizado automaticamente a cada 60s')],['duo',card('duo','duo-bot','Guerra Fria • Atualizado automaticamente a cada 60s')],['other',card('other','main','Guerra Fria • Moderação')]]);cards.last=()=>cards.get('other');
 await status.removeLegacyStatus({user:{id:'main'},channels:{fetch:async()=>({isSendable:()=>true,messages:{fetch:async()=>cards}})}});assert.deepEqual(deleted,['old']);
});
test('each dedicated status card includes its own connection button and wipe schedule',()=>{
 for(const id of ['solo-duo','trio']){const payload=status.statusCardPayload(snapshot(id,0));const button=payload.components[0].toJSON().components[0];assert.equal(new URL(button.url).searchParams.get('server'),id);assert.match(button.label,/Conectar/);if(id==='trio')assert.match(payload.embeds[0].toJSON().fields[0].value,/quarta-feira às 18h30/);}
});
