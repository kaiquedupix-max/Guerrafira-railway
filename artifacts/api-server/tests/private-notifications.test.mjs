import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createRequire} from 'node:module';
const state=globalThis.__privateAlerts={subscribers:[],sent:[],publicCalls:0,failDm:false,failDb:false};
const mocks={
 '@workspace/db':`export const adminNotificationSubscriptionsTable={enabled:'enabled'},adminWebPushSubscriptionsTable={};export const db={select(){return{from(){return{where:async()=>{if(globalThis.__privateAlerts.failDb)throw Error('DB unavailable');return globalThis.__privateAlerts.subscribers}}}}}};`,
 'client.js':`export const discordClient=()=>({users:{fetch:async id=>({send:async payload=>{if(globalThis.__privateAlerts.failDm)throw Error('DM closed');globalThis.__privateAlerts.sent.push({id,payload})}})},channels:{fetch:async()=>{globalThis.__privateAlerts.publicCalls++;throw Error('No public fallback allowed')}}});`,
 'logger.js':'export const logger={warn(){},error(){},info(){}};'
};
const result=await build({entryPoints:['src/admin/adminNotifications.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'private',setup(b){b.onResolve({filter:/.*/},a=>{const key=Object.keys(mocks).find(k=>a.path===k||a.path.endsWith('/'+k));if(key)return{path:key,namespace:'mock'}});b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const mod={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);const api=mod.exports;
delete process.env.WEB_PUSH_PUBLIC_KEY;delete process.env.WEB_PUSH_PRIVATE_KEY;
const alert={kind:'system',title:'Erro no wipe • Trio',message:'Falha técnica',severity:'critical'};
test('private wipe alerts include creator and subscribed admins exactly once',async()=>{state.subscribers=[{discordUserId:'123456789012345678'}];await api.notifySubscribedAdmins(alert,{additionalUserIds:['123456789012345678','223456789012345678','AUTOMATION']});assert.deepEqual(state.sent.map(x=>x.id),['123456789012345678','223456789012345678']);assert.equal(state.publicCalls,0);});
test('creator receives DM even if subscription lookup fails',async()=>{state.sent=[];state.failDb=true;await api.notifySubscribedAdmins(alert,{additionalUserIds:['223456789012345678']});state.failDb=false;assert.deepEqual(state.sent.map(x=>x.id),['223456789012345678']);});
test('closed DMs never redirect technical errors into a public channel',async()=>{state.sent=[];state.failDm=true;await api.notifySubscribedAdmins(alert,{additionalUserIds:['223456789012345678']});state.failDm=false;assert.equal(state.sent.length,0);assert.equal(state.publicCalls,0);});
