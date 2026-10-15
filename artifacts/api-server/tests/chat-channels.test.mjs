import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFile,unlink} from 'node:fs/promises';
const state=globalThis.__chatTest={stored:null};
const result=await build({entryPoints:['src/bot/chatChannels.ts'],bundle:true,platform:'node',format:'esm',packages:'external',write:false,plugins:[{name:'chat-adapters',setup(b){
 b.onResolve({filter:/^@workspace\/db$|lib\/logger\.js/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='@workspace/db'?`export const pool={query:async(sql,params)=>{if(sql.startsWith('SELECT'))return {rows:globalThis.__chatTest.stored?[{value:globalThis.__chatTest.stored}]:[]};if(params)globalThis.__chatTest.stored=params[0];return {rows:[]};}};`:'export const logger={warn(){},error(){},info(){}};'}));
}}]});
const temp=new URL('./.chat-test-runtime.mjs',import.meta.url);await writeFile(temp,result.outputFiles[0].text);let api;try{api=await import(temp.href);}finally{await unlink(temp);}
function fixture(){let clones=0,position;const channels=new Map();channels.find=fn=>[...channels.values()].find(fn);const duo={id:'duo',type:0,name:'chat-duo',parentId:'games',position:7,clone:async options=>{clones++;assert.equal(options.name,'chat-trio');const trio={id:'trio',type:0,name:options.name,parentId:'games',setPosition:async p=>position=p};channels.set(trio.id,trio);return trio;}};channels.set(duo.id,duo);return {channels,client:{guilds:{fetch:async()=>({channels:{fetch:async()=>channels}})}},get clones(){return clones},get position(){return position}};}
test('creates Trio beside Duo by cloning its category and permissions, then reuses it across restarts',async()=>{
 state.stored=null;process.env.DISCORD_GUILD_ID='guild';process.env.DISCORD_CHAT_CHANNEL_ID='duo';delete process.env.TRIO_DISCORD_CHAT_CHANNEL_ID;const f=fixture();
 await api.ensureServerChatChannels(f.client);assert.equal(f.clones,1);assert.equal(f.position,8);assert.equal(state.stored,'trio');assert.equal(process.env.TRIO_DISCORD_CHAT_CHANNEL_ID,'trio');
 delete process.env.TRIO_DISCORD_CHAT_CHANNEL_ID;await api.ensureServerChatChannels(f.client);assert.equal(f.clones,1);assert.equal(api.chatChannelFor('trio'),'trio');assert.equal(api.chatServerFor('duo'),'solo-duo');assert.equal(api.chatServerFor('trio'),'trio');assert.equal(api.chatServerFor('other'),null);
});
test('conflicting channel IDs never send Trio messages to the Duo channel and are repaired',async()=>{
 process.env.DISCORD_CHAT_CHANNEL_ID='duo';process.env.TRIO_DISCORD_CHAT_CHANNEL_ID='duo';assert.equal(api.chatChannelFor('trio'),undefined);
 const f=fixture();await api.ensureServerChatChannels(f.client);assert.equal(f.clones,1);assert.equal(api.chatChannelFor('trio'),'trio');
});
test('missing Duo channel does not create an arbitrary public chat',async()=>{process.env.DISCORD_CHAT_CHANNEL_ID='missing';const f=fixture();await api.ensureServerChatChannels(f.client);assert.equal(f.clones,0);});
test('accepts standard and generic BetterChat JSON while ignoring team chat, invalid data and non-chat events',()=>{
 const payload={Channel:0,UserId:'76561190000000001',Username:'Jogador',Message:'Olá Trio'};
 assert.equal(api.parseGameChat(JSON.stringify(payload)).Message,'Olá Trio');assert.equal(api.parseGameChat('BetterChat: '+JSON.stringify(payload)).Username,'Jogador');
 for(const raw of [JSON.stringify({...payload,Channel:1}),JSON.stringify({...payload,Channel:2}),JSON.stringify({...payload,UserId:'0'}),'serverinfo','{}'])assert.equal(api.parseGameChat(raw),null);
});
