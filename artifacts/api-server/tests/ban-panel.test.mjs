import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFile, unlink } from 'node:fs/promises';
const calls = [];
globalThis.__banCalls = calls;
const result = await build({stdin:{contents:'export * from "./src/bot/commands/banir.ts";export * from "./src/core/adminServerContext.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,packages:'external',plugins:[{name:'mock',setup(b){
 b.onResolve({filter:/players\.js|\.\/duo\.js|systemActions\.js/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path.includes('players')?'export const searchPlayers=async()=>[];':a.path.includes('duo')?'export const getTeamMembers=async()=>[{steamId:"76561190000000001",name:"Principal"},{steamId:"76561190000000002",name:"Duo"},{steamId:"76561190000000002",name:"Duo"}];':'export class ActionError extends Error {};export const banPlayer=async x=>{globalThis.__banCalls.push({...x,server:globalThis.__banReadServer()});if(globalThis.__banFail===x.steamId)throw new ActionError("Servidor recusou o ban");return {playerName:x.association?"Duo":"Principal",expiresAt:null,gameNotified:globalThis.__noticeFail!==x.steamId};};'}));
}}]});
const file=new URL('./.ban-panel-bundle.mjs',import.meta.url);
await writeFile(file,result.outputFiles[0].text);
const command=await import(file.href);await unlink(file);
globalThis.__banReadServer=()=>command.adminServer();
async function open(config={}){
 const handlers={},replies=[];
 const collector={on:(name,fn)=>{handlers[name]=fn;},stop(){}};
 const interaction={user:{id:'admin',username:'Admin'},guild:null,inGuild:()=>true,memberPermissions:{has:()=>true},options:{getString:key=>key==='jogador'?'76561190000000001':null},deferReply:async()=>{},editReply:async value=>{replies.push(value);return {createMessageComponentCollector:()=>collector};}};
 await command.execute(interaction);
 const collect=(id,values)=>handlers.collect({id:'test-interaction',customId:id,values,isStringSelectMenu:()=>Boolean(values),update:async payload=>{replies.push(payload);},deferUpdate:async()=>{},reply:async payload=>{replies.push(payload);},showModal:async modal=>{modal.toJSON();},awaitModalSubmit:async()=>({fields:{getTextInputValue:key=>key==='count'?config.count:config.members},deferUpdate:async()=>{},followUp:async payload=>{replies.push(payload);}})});
 return {replies,click:id=>collect(id),select:(id,value)=>collect(id,[value])};
}
test('confirmation bans principal and unique duo with separate reasons, once',async()=>{
 calls.length=0;const panel=await open({count:'2',members:'76561190000000002'});assert.equal(calls.length,0);assert.equal(panel.replies[0].components.length,5);await panel.click('ban_panel_roster');
 await panel.click('ban_panel_confirm');assert.equal(calls.length,2);assert.equal(calls[0].reason,'Cheat / Trapaça');assert.match(calls[1].reason,/Banido por associação/);assert.equal(calls[1].association.steamId,calls[0].steamId);
 await panel.click('ban_panel_confirm');assert.equal(calls.length,2);
});
test('cancel never bans',async()=>{calls.length=0;const panel=await open();await panel.click('ban_panel_cancel');assert.equal(calls.length,0);});
test('team-limit bans all four players for the same violation with individual notifications',async()=>{
 calls.length=0;const panel=await open({count:'4',members:'76561190000000002\n76561190000000003\n76561190000000004'});
 await panel.select('ban_panel_reason','team_limit');assert.equal(calls.length,0);
 await panel.click('ban_panel_roster');assert.equal(calls.length,0);
 await panel.click('ban_panel_confirm');assert.equal(calls.length,4);assert.equal(new Set(calls.map(c=>c.steamId)).size,4);
 for(const call of calls){assert.equal(call.reason,'Violação do limite de jogadores por time');assert.equal(call.association,undefined);assert.equal(call.duration,'perm');}
 assert.match(panel.replies.at(-1),/4\/4/);
});
test('three-member team can be configured independently of the detected duo',async()=>{
 calls.length=0;const panel=await open({count:'3',members:'76561190000000002\n76561190000000003'});await panel.select('ban_panel_reason','team_limit');await panel.click('ban_panel_roster');await panel.click('ban_panel_confirm');assert.equal(calls.length,3);
});
test('count mismatch and duplicate members prevent all team-limit bans',async()=>{
 calls.length=0;const panel=await open({count:'4',members:'76561190000000002\n76561190000000002'});await panel.select('ban_panel_reason','team_limit');await panel.click('ban_panel_roster');await panel.click('ban_panel_confirm');assert.equal(calls.length,0);assert.ok(panel.replies.some(r=>r.content?.includes('jogadores únicos')));
});
test('team count must be an integer and include the main player',async()=>{
 await assert.rejects(command.resolveTeamRoster('76561190000000001','1','76561190000000002'),/mínimo 2/);
 await assert.rejects(command.resolveTeamRoster('76561190000000001','3.5','76561190000000002'),/mínimo 2/);
 const roster=await command.resolveTeamRoster('76561190000000001','2','76561190000000001\n76561190000000002');assert.equal(roster.length,2);
});
test('a failed team ban does not hide failures or stop notifications for later members',async()=>{
 calls.length=0;globalThis.__banFail='76561190000000003';globalThis.__noticeFail='76561190000000002';
 try {const panel=await open({count:'4',members:'76561190000000002\n76561190000000003\n76561190000000004'});await panel.select('ban_panel_reason','team_limit');await panel.click('ban_panel_roster');await panel.click('ban_panel_confirm');assert.equal(calls.length,4);assert.match(panel.replies.at(-1),/3\/4/);assert.match(panel.replies.at(-1),/Servidor recusou o ban/);assert.match(panel.replies.at(-1),/sem confirmação da notificação/);} finally {delete globalThis.__banFail;delete globalThis.__noticeFail;}
});

test('slash ban only requests the player; reason is visible in the panel',async()=>{
 assert.deepEqual(command.data.toJSON().options.map(o=>o.name),['jogador']);const panel=await open();assert.match(panel.replies[0].content,/Motivo: Cheat/);const options=panel.replies[0].components[0].toJSON().components[0].options;assert.ok(options.some(o=>o.value==='team_limit'));
});
test('other players can be selected from the roster picker before association bans',async()=>{
 calls.length=0;const panel=await open();await panel.click('ban_panel_choose');assert.match(panel.replies.at(-1).content,/Selecione os outros jogadores/);await panel.select('ban_panel_count','2');await panel.select('ban_panel_members','76561190000000002');await panel.click('ban_panel_back');await panel.click('ban_panel_confirm');assert.equal(calls.length,2);assert.ok(calls[1].association);
});

test('a delayed ban confirmation keeps the Trio team selection context',async()=>{
 calls.length=0;
 const panel=await command.withAdminServer('trio',()=>open({count:'2',members:'76561190000000002'}));
 assert.equal(command.adminServer(),'solo-duo');
 await panel.click('ban_panel_roster');
 await panel.click('ban_panel_confirm');
 assert.equal(calls.length,2);
 assert.ok(calls.every(call=>call.server==='trio'));
 assert.equal(command.adminServer(),'solo-duo');
});
