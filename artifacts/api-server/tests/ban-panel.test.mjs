import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFile, unlink } from 'node:fs/promises';
const calls = [];
globalThis.__banCalls = calls;
const result = await build({entryPoints:['src/bot/commands/banir.ts'],bundle:true,platform:'node',format:'esm',write:false,packages:'external',plugins:[{name:'mock',setup(b){
 b.onResolve({filter:/players\.js|\.\/duo\.js|systemActions\.js/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path.includes('players')?'export const searchPlayers=async()=>[];':a.path.includes('duo')?'export const getTeamMembers=async()=>[{steamId:"76561190000000001",name:"Principal"},{steamId:"76561190000000002",name:"Duo"},{steamId:"76561190000000002",name:"Duo"}];':'export class ActionError extends Error {};export const banPlayer=async x=>{globalThis.__banCalls.push(x);return {playerName:x.association?"Duo":"Principal",expiresAt:null};};'}));
}}]});
const file=new URL('./.ban-panel-bundle.mjs',import.meta.url);
await writeFile(file,result.outputFiles[0].text);
const command=await import(file.href);await unlink(file);
async function open(){
 const handlers={},replies=[];
 const collector={on:(name,fn)=>{handlers[name]=fn;},stop(){}};
 const interaction={user:{id:'admin',username:'Admin'},guild:null,inGuild:()=>true,memberPermissions:{has:()=>true},options:{getString:key=>key==='jogador'?'76561190000000001':null},deferReply:async()=>{},editReply:async value=>{replies.push(value);return {createMessageComponentCollector:()=>collector};}};
 await command.execute(interaction);
 return {replies,click:id=>handlers.collect({customId:id,isStringSelectMenu:()=>false,update:async()=>{},deferUpdate:async()=>{}})};
}
test('confirmation bans principal and unique duo with separate reasons, once',async()=>{
 calls.length=0;const panel=await open();assert.equal(calls.length,0);assert.equal(panel.replies[0].components.length,5);
 await panel.click('ban_panel_confirm');assert.equal(calls.length,2);assert.equal(calls[0].reason,'Cheat / Trapaça');assert.match(calls[1].reason,/Banido por associação/);assert.equal(calls[1].association.steamId,calls[0].steamId);
 await panel.click('ban_panel_confirm');assert.equal(calls.length,2);
});
test('cancel never bans',async()=>{calls.length=0;const panel=await open();await panel.click('ban_panel_cancel');assert.equal(calls.length,0);});
