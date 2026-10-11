import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const state=globalThis.__voteTest={rows:[],updates:[]};
state.db={select:()=>({from:()=>({where:()=>{const rows=state.rows.shift()||[];return {then:(yes,no)=>Promise.resolve(rows).then(yes,no),limit:async()=>rows};}})})};
const mocks={
 'adminNotifications.js':'export const publishAdminNotification=()=>{},notifyAdmins=()=>{};',
 'client.js':'export const discordClient=()=>null;',
 '@workspace/db':'export const db=globalThis.__voteTest.db; export const pool={query:async(sql,args)=>globalThis.__voteTest.updates.push({sql,args})}; export const mapVotesTable={},mapVoteBallotsTable={},vipSubscriptionsTable={},boosterLinksTable={};',
 'hostWipe.js':'export const diagnoseHost=()=>{},executePreparedProceduralWipe=()=>{},executePreparedWipe=()=>{},prepareProceduralWipeBackup=()=>{};',
 'wipeLock.js':'export const getWipeLockState=()=>{};',
 'gameAnnouncement.js':'export const sendGameAnnouncement=()=>{};',
 'logger.js':'export const logger={info(){},warn(){},error(){}};'
};
const output=await build({entryPoints:['src/bot/commands/criarmapa.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'mock',setup(p){
 p.onResolve({filter:/.*/},a=>{const key=Object.keys(mocks).find(k=>a.path===k||a.path.endsWith('/'+k));if(key)return{path:key,namespace:'mock'};});
 p.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));
 p.onLoad({filter:/criarmapa\.ts$/},a=>({contents:readFileSync(a.path,'utf8').replace('async function getVoteWeight(', 'export async function getVoteWeight('),loader:'ts'}));
}}]});
const mod={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const guild=(roles=[],boost=false)=>({members:{fetch:async()=>({roles:{cache:new Set(roles)},premiumSinceTimestamp:boost?1:null})}});
test('Discord roles, native boosting and database entitlements grant weight two without stacking',async()=>{
 for(const [g,v,b] of [[guild(['1499084540356853917']),[],[]],[guild(['1536607642364018688']),[],[]],[guild([],true),[],[]],[guild(),[{gameVipRemoved:false,discordRoleRemoved:true}],[]],[guild(),[],[{active:true}]]]){
  state.rows=[v,b];assert.equal((await mod.exports.getVoteWeight('u',g)).weight,2);
 }
 state.rows=[[],[]];assert.equal((await mod.exports.getVoteWeight('u',guild())).weight,1);
 state.rows=[[],[]];assert.equal((await mod.exports.getVoteWeight('u',guild(['1499084540356853917'],true))).weight,2);
});
test('active ballots are promoted in place with a guard against finalized votes',async()=>{
 state.updates=[];state.rows=[[{id:7,channelId:'c'}],[{id:8,discordUserId:'u',weight:1,isVip:false,isBooster:false,optionIndex:2}],[],[]];
 await mod.exports.repairActiveVoteWeights({channels:{fetch:async()=>({guild:guild(['1499084540356853917'])})}});
 assert.equal(state.updates.length,1);assert.deepEqual(state.updates[0].args,[true,false,8,7]);
 assert.match(state.updates[0].sql,/status='active'/);assert.doesNotMatch(state.updates[0].sql,/option_index\s*=/);
});
