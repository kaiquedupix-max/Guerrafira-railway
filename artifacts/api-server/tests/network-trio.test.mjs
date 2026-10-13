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
const snapshot=(id,players)=>status.parseOnlineSnapshot(id,JSON.stringify({Players:players,MaxPlayers:200}));
test('principal status adds online Duo and Trio counts, excluding queue',()=>{
 assert.match(status.networkPresence([snapshot('solo-duo',37),snapshot('trio',21)]),/^58 jogadores online/);
});
test('unavailable status is explicitly partial rather than a false total',()=>{
 assert.match(status.networkPresence([snapshot('solo-duo',37),status.parseOnlineSnapshot('trio',null)]),/^37\+ online.*Trio indisponível/);
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
 const future=new Date(Date.now()+8*86400000);while(![1,5].includes(future.getUTCDay()))future.setUTCDate(future.getUTCDate()+1);
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
