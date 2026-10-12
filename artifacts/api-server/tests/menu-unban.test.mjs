import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFile, unlink } from 'node:fs/promises';
import { PermissionsBitField } from 'discord.js';
async function load(path, name) {
 const result = await build({ entryPoints:[path],bundle:true,platform:'node',format:'esm',write:false,packages:'external',plugins:[{name:'logger',setup(b){b.onResolve({filter:/lib\/logger\.js/},()=>({path:'logger',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const logger={error(){}};'}));}}] });
 const file=new URL(`./.${name}-test-bundle.mjs`,import.meta.url);await writeFile(file,result.outputFiles[0].text);try{return await import(file.href);}finally{await unlink(file);}
}
const menu=await load('src/bot/commands/menu.ts','menu');
const rust=await load('src/core/rustUnban.ts','unban');
const admin=new PermissionsBitField(PermissionsBitField.Flags.Administrator);
const user=new PermissionsBitField(0n);
const command=(definition,execute=async()=>{})=>({data:{name:definition.name,toJSON:()=>definition},execute});
function harness(steps,{permissions=()=>admin,attachment=null}={}) {
 const replies=[];let shown,fetches=0;
 const interaction={user:{id:'admin'},guild:{members:{fetch:async()=>({permissions:permissions(++fetches)})}},inGuild:()=>true,options:{getAttachment:()=>attachment},deferReply:async()=>{},editReply:async payload=>{replies.push(payload);return message;}};
 const message={awaitMessageComponent:async({filter})=>{
  const step=steps.shift();assert.ok(step,'unexpected additional panel step');
  const components=replies.at(-1).components.flatMap(r=>r.toJSON().components);
  const selected=components.find(c=>c.custom_id.endsWith(':'+step.action));assert.ok(selected,`missing control ${step.action}`);
  const i={...interaction,customId:selected.custom_id,values:[step.value??'0'],replied:false,deferred:false,
   isStringSelectMenu:()=>step.type==='select',isUserSelectMenu:()=>false,isChannelSelectMenu:()=>false,isRoleSelectMenu:()=>false,
   update:async payload=>{i.replied=true;await interaction.editReply(payload);},deferUpdate:async()=>{i.deferred=true;},
   showModal:async modal=>{shown=modal.toJSON();},awaitModalSubmit:async({filter})=>{const m={user:interaction.user,customId:shown.custom_id,fields:{getTextInputValue:()=>step.text},deferUpdate:async()=>{}};assert.ok(filter(m));return m;}};
  assert.ok(filter(i));assert.equal(filter({...i,user:{id:'stranger'}}),false);return i;
 }};
 return {interaction,replies};
}
test('all subcommands become menu entries and preserve their fields',()=>{
 const c=command({name:'steam',options:[{name:'consultar',type:1,options:[{name:'usuario',type:6,required:true}]},{name:'grupo',type:2,options:[{name:'trocar',type:1,options:[]}]}]});
 assert.deepEqual(menu.menuEntries([c]).map(e=>[e.label,e.path,e.fields.length]),[['steam consultar',['consultar'],1],['steam grupo trocar',['grupo','trocar'],0]]);
});
test('permission checks respect public, moderator and admin-only definitions',()=>{
 assert.equal(menu.canUse({},user),true);assert.equal(menu.canUse({default_member_permissions:'0'},user),false);assert.equal(menu.canUse({default_member_permissions:'0'},admin),true);
 assert.equal(menu.canUse({default_member_permissions:String(PermissionsBitField.Flags.BanMembers)},user),false);
});
test('numeric input validates declared limits before running',()=>{
 assert.equal(menu.validateValue({type:4,min_value:1,max_value:10},'3'),3);
 for(const raw of ['0','11','1.5','abc'])assert.throws(()=>menu.validateValue({type:4,min_value:1,max_value:10},raw));
});
test('menu searches names, selects a SteamID, collects text and confirms exactly once',async()=>{
 const executions=[];const c=command({name:'desbanir',description:'Desbanir',options:[{name:'jogador',description:'Jogador',type:3,required:true,autocomplete:true},{name:'motivo',description:'Motivo',type:3,required:true}]},async i=>{await i.deferReply();executions.push([i.options.getString('jogador',true),i.options.getString('motivo',true)]);await i.editReply({content:'Desbanido'});});
 c.autocomplete=async i=>{assert.equal(i.options.getFocused(),'Duo');await i.respond([{name:'Duo',value:'76561190000000002'}]);};
 menu.configureMenu([c]);const h=harness([{action:'command',type:'select'},{action:'fill',text:'Duo'},{action:'result',type:'select',value:'76561190000000002'},{action:'fill',text:'Recurso aprovado'},{action:'execute'}]);
 await menu.execute(h.interaction);assert.deepEqual(executions,[['76561190000000002','Recurso aprovado']]);assert.equal(h.replies.at(-1).content,'Desbanido');
});
test('cancel runs no command',async()=>{let calls=0;menu.configureMenu([command({name:'teste',description:'Teste'},async()=>calls++)]);const h=harness([{action:'cancel'}]);await menu.execute(h.interaction);assert.equal(calls,0);});
test('permissions are checked again immediately before execution',async()=>{let calls=0;menu.configureMenu([command({name:'teste',description:'Teste',default_member_permissions:'0'},async()=>calls++)]);const h=harness([{action:'command',type:'select'},{action:'execute'}],{permissions:n=>n===1?admin:user});await menu.execute(h.interaction);assert.equal(calls,0);assert.match(h.replies.at(-1).content,/permissão/);});
test('pagination exposes commands beyond the Discord limit of 25 options',async()=>{let chosen='';menu.configureMenu(Array.from({length:30},(_,n)=>command({name:'cmd'+n,description:'Teste'},async()=>{chosen='cmd'+n;})));const h=harness([{action:'next'},{action:'command',type:'select',value:'29'},{action:'execute'}]);await menu.execute(h.interaction);assert.equal(chosen,'cmd29');});
test('unban checks server state and saves before succeeding',async()=>{const calls=[];await rust.removeRustBan('76561190000000002',async cmd=>{calls.push(cmd);return cmd==='banlist'?'76561190000000001 Other player':'OK';});assert.deepEqual(calls,['unban 76561190000000002','banlist','server.writecfg']);});
test('unban refuses success when the player is still banned',async()=>{const calls=[];await assert.rejects(rust.removeRustBan('76561190000000002',async cmd=>{calls.push(cmd);return cmd==='banlist'?'76561190000000002 Duo':'OK';}),/continua banido/);assert.equal(calls.includes('server.writecfg'),false);});
test('unban rejects RCON error responses and invalid SteamIDs',async()=>{await assert.rejects(rust.removeRustBan('76561190000000002',async()=> 'Unknown command: unban'),/recusou/);await assert.rejects(rust.removeRustBan('bad',async()=>{throw Error('must not execute');}),/SteamID inválido/);});
test('unban does not report success when transport or save fails',async()=>{await assert.rejects(rust.removeRustBan('76561190000000002',async()=>{throw Error('offline');}),/offline/);await assert.rejects(rust.removeRustBan('76561190000000002',async cmd=>cmd==='server.writecfg'?'Error saving file':''),/salvamento/);});
