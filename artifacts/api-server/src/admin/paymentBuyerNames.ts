import { pool } from "@workspace/db";
import { discordClient } from "../bot/client.js";
import { getSteamProfileSummaries } from "./steamProfiles.js";

type BuyerRow = { id: number | string; steam_id?: string | null; discord_user_id?: string | null };
export function discordBuyerDisplayName(member: any, user: any): string {
  // displayName falls back to username in discord.js; do not expose that fallback.
  return member?.nickname?.trim() || member?.user?.globalName?.trim() || user?.globalName?.trim() || "Nome de exibição indisponível";
}
const names = new Map<string, { value: string; until: number }>();
async function discordName(id: string): Promise<string> {
  const cached=names.get(id);if(cached&&cached.until>Date.now())return cached.value;
  const client=discordClient(),guildId=process.env.DISCORD_GUILD_ID;
  const guild=client&&guildId?await client.guilds.fetch(guildId).catch(()=>null):null;
  const member=guild?(guild.members.cache.get(id)||await guild.members.fetch(id).catch(()=>null)):null;
  const user=member?.user||(client&&id?await client.users.fetch(id).catch(()=>null):null);
  const value=discordBuyerDisplayName(member,user);names.set(id,{value,until:Date.now()+5*60_000});return value;
}
export async function paymentBuyerNames(rows: BuyerRow[]) {
  const ids=[...new Set(rows.map(r=>r.steam_id||"").filter(Boolean))];
  const profiles=await getSteamProfileSummaries(ids).catch(()=>new Map());
  const stored=ids.length?await pool.query("SELECT steam_id,player_name FROM players WHERE steam_id=ANY($1::text[])",[ids]).catch(()=>({rows:[]})):{rows:[]};
  const localNames=new Map(stored.rows.map((p:any)=>[p.steam_id,p.player_name]));
  const discordNames=new Map<string,string>();
  const discordIds=[...new Set(rows.map(r=>r.discord_user_id||"").filter(Boolean))];
  for(let i=0;i<discordIds.length;i+=6)await Promise.all(discordIds.slice(i,i+6).map(async id=>discordNames.set(id,await discordName(id))));
  return new Map(rows.map(row=>{const steam=row.steam_id||"";return [String(row.id),{
    steamName:profiles.get(steam)?.personaName||localNames.get(steam)||"Nome Steam indisponível",
    steamProfileUrl:/^7656119\d{10}$/.test(steam)?`https://steamcommunity.com/profiles/${steam}`:null,
    discordDisplayName:discordNames.get(row.discord_user_id||"")||"Nome de exibição indisponível",
  }];}));
}
