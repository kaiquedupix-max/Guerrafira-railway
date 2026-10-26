import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
const originalFetch=globalThis.fetch;
const oldGuild=process.env.DISCORD_GUILD_ID,oldToken=process.env.DISCORD_BOT_TOKEN;
after(()=>{globalThis.fetch=originalFetch;for(const [key,value] of [['DISCORD_GUILD_ID',oldGuild],['DISCORD_BOT_TOKEN',oldToken]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
const result=await build({entryPoints:['src/admin/discordMembership.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {joinGuerraFriaDiscord}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
test('joins only configured guild with user consent; existing membership is successful',async()=>{
 process.env.DISCORD_GUILD_ID='guild';process.env.DISCORD_BOT_TOKEN='bot';
 for(const status of [201,204]){
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://discord.com/api/v10/guilds/guild/members/user');assert.equal(options.method,'PUT');assert.equal(options.headers.Authorization,'Bot bot');assert.deepEqual(JSON.parse(options.body),{access_token:'consented-token'});return {status};};
  await joinGuerraFriaDiscord('user','consented-token');
 }
});
test('denied or unavailable membership never silently succeeds and secrets stay out of errors',async()=>{
 for(const status of [400,403,429,500]){globalThis.fetch=async()=>({status,json:async()=>({code:50013})});await assert.rejects(joinGuerraFriaDiscord('user','secret-token'),error=>error.message.includes('50013')&&!error.message.includes('secret-token'));}
 delete process.env.DISCORD_GUILD_ID;await assert.rejects(joinGuerraFriaDiscord('user','token'),/não configurada/);
});
test('active site login requests guilds.join and joins before issuing sessions',async()=>{
 const source=await readFile('src/admin/oauthRoutesV3.ts','utf8');assert.match(source,/scope: "identify guilds.join"/);assert.ok(source.indexOf('await joinGuerraFriaDiscord(user.id, token.access_token)')<source.indexOf('issueCommunitySession(res,'));
});
