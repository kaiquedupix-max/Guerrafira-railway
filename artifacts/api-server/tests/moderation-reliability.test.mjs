import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFile, unlink } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { pgTable, serial, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { Collection } from 'discord.js';

const pg = new PGlite();
await pg.exec("CREATE TABLE mod_logs(id SERIAL PRIMARY KEY,server_id TEXT NOT NULL DEFAULT 'solo-duo',action TEXT NOT NULL,steam_id TEXT NOT NULL,player_name TEXT NOT NULL,reason TEXT,admin_id TEXT NOT NULL,admin_name TEXT NOT NULL,ban_duration TEXT,ban_expires_at TIMESTAMPTZ,public_visible BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
const table = pgTable('mod_logs', {
  id: serial('id').primaryKey(), serverId: text('server_id'), action: text('action'), steamId: text('steam_id'), playerName: text('player_name'), reason: text('reason'), adminId: text('admin_id'), adminName: text('admin_name'), banDuration: text('ban_duration'), banExpiresAt: timestamp('ban_expires_at', { withTimezone: true }), publicVisible: boolean('public_visible'), createdAt: timestamp('created_at', { withTimezone: true }),
});
const state = globalThis.__reliability = { db: drizzle(pg), table, commands: [], messages: new Map(), nativeBans: new Map(), failServer: null, rejectMute: false, rejectBan: false, failDelete: false, fetches: 0 };
let sequence = 0;
function message(channelId, data, author = 'bot') {
  const row = { id: String(++sequence), channelId, author: { id: author }, embeds: data.embeds.map(embed => embed.toJSON ? embed.toJSON() : embed),
    async edit(next) { this.embeds = next.embeds.map(embed => embed.toJSON()); return this; },
    async delete() { if (state.failDelete) throw Error('Discord unavailable'); state.messages.delete(this.id); },
  };
  state.messages.set(row.id, row); return row;
}
const channel = id => ({ isTextBased: () => true, isSendable: () => true,
  async send(data) { return message(id, data); },
  messages: { async fetch(options) {
    state.fetches++;
    if (typeof options === 'string') { const row = state.messages.get(options); if (!row) throw Object.assign(Error('Unknown message'), { code: 10008 }); return row; }
    const rows = [...state.messages.values()].filter(row => row.channelId === id && (!options.before || Number(row.id) < Number(options.before))).sort((a, b) => Number(b.id) - Number(a.id)).slice(0, options.limit);
    return new Collection(rows.map(row => [row.id, row]));
  } },
});
state.client = { isReady: () => true, user: { id: 'bot' }, channels: { fetch: async id => channel(id) } };
process.env.DISCORD_LOG_CHANNEL_ID = 'main'; process.env.TRIO_DISCORD_LOG_CHANNEL_ID = 'main';
const built = await build({ stdin: { contents: 'export * from "./src/core/systemActions.ts";export * from "./src/core/chatModeration.ts";export * from "./src/core/publicModerationRecords.ts";export * from "./src/core/adminServerContext.ts";', resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false,
  plugins: [{ name: 'adapters', setup(b) {
    b.onResolve({ filter: /^@workspace\/db$|bot\/client\.js|utils\/players\.js|utils\/rcon\.js|admin\/steamProfiles\.js|lib\/logger\.js|ipModeration\.js/ }, a => ({ path: a.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ contents:
      a.path === '@workspace/db' ? 'export const db=globalThis.__reliability.db,modLogsTable=globalThis.__reliability.table,playersTable={};' :
      a.path.includes('players') ? 'export const getPlayerBySteamId=async steamId=>({steamId,playerName:"Tester",isOnline:true});' :
      a.path.includes('rcon') ? 'export const executeRconCommand=cmd=>globalThis.__reliability.run(cmd);export const getOnlinePlayers=async()=>[{steamId:"76561190000000002",name:"Tester"}];' :
      a.path.includes('client') ? 'export const discordClient=()=>globalThis.__reliability.client;' :
      a.path.includes('steamProfiles') ? 'export const getSteamProfileSummaries=async()=>new Map();' :
      a.path.includes('ipModeration') ? 'export const collectPlayerAddresses=async()=>[],protectPlayerIp=async()=>true,removePlayerIpBan=async()=>{},ensureIpModeration=async()=>{},resetModerationReadiness=()=>{};' :
      'export const logger={warn(){},error(){},info(){}};',
    }));
  } }],
});
const output = new URL('./.reliability-test-bundle.mjs', import.meta.url); await writeFile(output, built.outputFiles[0].text); const api = await import(output.href); await unlink(output);
state.run = async command => {
  const server = api.adminServer(); state.commands.push({ server, command });
  if (state.failServer === server) return 'Unknown command';
  const bans = state.nativeBans.get(server) || new Set(); state.nativeBans.set(server, bans);
  const id = command.split(' ')[1];
  if (command.startsWith('banid ') && !state.rejectBan) bans.add(id);
  if (command.startsWith('unban ')) bans.delete(id);
  if (command === 'banlist') return [...bans].join('\n');
  if (command.startsWith('gf.guard.mute ')) return state.rejectMute ? '' : `GF_GUARD_MUTED ${id}`;
  if (command.startsWith('gf.guard.unmute ')) return state.rejectMute ? '' : `GF_GUARD_UNMUTED ${id}`;
  return '';
};
const steamId = '76561190000000002', actor = { id: 'admin', name: 'Admin', source: 'web' }, input = { steamId, duration: '3d', reason: 'Teste', actor };
const cards = () => [...state.messages.values()].filter(row => row.author.id === 'bot' && /Banimento/.test(row.embeds[0]?.title));
beforeEach(async () => { await pg.exec('TRUNCATE mod_logs RESTART IDENTITY'); state.commands = []; state.messages.clear(); state.nativeBans.clear(); state.failServer = null; state.rejectMute = false; state.rejectBan = false; state.failDelete = false; state.fetches = 0; process.env.TRIO_DISCORD_LOG_CHANNEL_ID = 'main'; });
after(async () => { await pg.close(); delete globalThis.__reliability; });

test('both servers ban successfully but create one network card; repeated ban edits it', async () => {
  await api.banPlayer(input); assert.equal(cards().length, 1);
  assert.match(cards()[0].embeds[0].description, /Banido de todos os servidores do Guerra Fria/);
  assert.equal(state.commands.filter(row => row.command.startsWith('banid ')).length, 2);
  const cardId = cards()[0].id; state.fetches = 0;
  await api.banPlayer(input); assert.equal(cards().length, 1); assert.equal(cards()[0].id, cardId); assert.equal(state.fetches, 1, 'persisted reference avoids re-scanning channel history');
});
test('unban needs no reason, emits no announcement, hides audit and deletes the card', async () => {
  await api.banPlayer(input); state.commands = [];
  await api.unbanPlayer({ steamId, actor });
  assert.equal(cards().length, 0); assert.equal(state.commands.some(row => row.command.startsWith('say ')), false);
  const rows = (await pg.query("SELECT public_visible FROM mod_logs WHERE action='DESBANIR'")).rows;
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.public_visible === false));
});
test('unban removes legacy duplicates even beyond the first 100 channel messages', async () => {
  process.env.TRIO_DISCORD_LOG_CHANNEL_ID = 'trio';
  const embed = { title: '🔨 Banimento aplicado', fields: [{ name: 'SteamID', value: `\`${steamId}\`` }] };
  message('main', { embeds: [embed] }); message('trio', { embeds: [embed] });
  for (let i = 0; i < 110; i++) message('main', { embeds: [{ title: 'Outro registro', fields: [] }] });
  const unrelated = message('main', { embeds: [embed] }, 'other-bot');
  await api.unbanPlayer({ steamId, actor });
  assert.equal(cards().length, 0); assert.ok(state.messages.has(unrelated.id)); assert.ok(state.fetches >= 3);
});
test('partial ban produces no false all-servers card; retry creates one after confirmation', async () => {
  state.failServer = 'trio'; await assert.rejects(api.banPlayer(input), /Trio/); assert.equal(cards().length, 0);
  state.failServer = null; await api.syncPendingNetworkBans(); assert.equal(cards().length, 1);
});
test('Discord deletion failure queues cleanup and does not repeat a successful game unban', async () => {
  await api.banPlayer(input); state.failDelete = true;
  await api.unbanPlayer({ steamId, actor });
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM mod_logs WHERE action='BAN_CARD_PENDING'")).rows[0].n, 1);
  state.failDelete = false; state.commands = []; await api.syncPendingNetworkBans();
  assert.equal(cards().length, 0); assert.equal(state.commands.length, 0);
});
test('empty RCON response cannot falsely confirm a mute; confirmed mute/unmute stay on Trio', async () => {
  state.rejectMute = true;
  await assert.rejects(api.withAdminServer('trio', () => api.moderateChat({ steamId, actor, muted: true, duration: '10m', reason: 'Teste' })), /não confirmou/);
  assert.equal((await pg.query('SELECT * FROM mod_logs')).rows.length, 0);
  state.rejectMute = false;
  await api.withAdminServer('trio', () => api.moderateChat({ steamId, actor, muted: true, duration: '10m', reason: 'Teste' }));
  await api.withAdminServer('trio', () => api.moderateChat({ steamId, actor, muted: false }));
  assert.ok(state.commands.every(row => row.server === 'trio'));
  assert.equal((await pg.query("SELECT action FROM mod_logs ORDER BY id")).rows.map(row => row.action).join(), 'MUTE,UNMUTE');
});
test('ban is not audited as successful when Rust omits the player from banlist', async () => {
  state.rejectBan = true; await assert.rejects(api.banPlayer(input), /pendente/);
  assert.equal((await pg.query("SELECT * FROM mod_logs WHERE action='BAN'")).rows.length, 0); assert.equal(cards().length, 0);
});
test('expired old ban cannot remove a new ban or a new pending network ban', async () => {
  await api.banPlayer(input); const old = await api.withAdminServer('trio', () => api.activeBan(steamId));
  await pg.query("UPDATE mod_logs SET ban_expires_at=NOW()-INTERVAL '1 minute' WHERE action='BAN'");
  state.failServer = 'trio'; await assert.rejects(api.banPlayer({ ...input, duration: 'perm' }), /Trio/);
  state.failServer = null; state.commands = [];
  await api.withAdminServer('trio', () => api.expireBanIfCurrent(steamId, old.id));
  assert.equal(state.commands.some(row => row.command.startsWith('unban ')), false);
});

test('public records deduplicate network bans and remove a ban after a silent unban', async () => {
  await api.banPlayer(input); let records = await api.publicModerationRecords();
  assert.equal(records.filter(row => row.action === 'BAN').length, 1);
  await api.unbanPlayer({ steamId, actor }); records = await api.publicModerationRecords();
  assert.equal(records.length, 0);
});
test('ambiguous delivery never automatically repeats an inventory grant', async () => {
  const run = state.run; let sent = 0; state.run = async () => { sent++; return null; };
  try { await assert.rejects(api.executeRconRequired('inventory.giveto '+steamId+' wood 1'), /pode ter sido executada/); assert.equal(sent, 1); }
  finally { state.run = run; }
});
