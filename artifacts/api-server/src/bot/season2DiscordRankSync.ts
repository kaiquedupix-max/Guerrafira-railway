import { type Client, type Guild, type GuildMember, type Role } from "discord.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { rankForSeason, ranksForSeason, xpFromMmr } from "../routes/seasonRanks.js";

const SEASON = 2;
const OFFICIAL_KEY = 102;
const STARTING_MMR = 1000;
const REGISTERED_ROLE_NAME = "Season 2 • Inscrito";
const RANK_PREFIX = "S2 • ";
let timer: NodeJS.Timeout | null = null;
let running = false;

type Enrolled = { discord_id:string; steam_id:string; status:string; effective_mmr:number|string|null; position:number|string|null };

async function enrolledPlayers(): Promise<Enrolled[]> {
  const result:any = await db.execute(sql`
    WITH sd AS (
      SELECT steam_id,mmr,kills,updated_at FROM season_players WHERE season_number=${SEASON}
    ),
    adjustments AS (
      SELECT steam_id,COALESCE(SUM(final_value),0) delta
      FROM season_transactions WHERE season_number=${SEASON} AND category='admin' GROUP BY steam_id
    ),
    active AS (
      SELECT r.discord_id,r.steam_id,r.status,r.created_at,
             COALESCE(sd.mmr,${STARTING_MMR})+COALESCE(a.delta,0) effective_mmr,
             COALESCE(sd.kills,0) kills,COALESCE(sd.updated_at,r.created_at) updated_at
      FROM season_official_registrations r
      LEFT JOIN sd ON sd.steam_id=r.steam_id
      LEFT JOIN adjustments a ON a.steam_id=r.steam_id
      WHERE r.season_key=${OFFICIAL_KEY} AND r.status='active'
    ),
    ranked AS (
      SELECT active.*,ROW_NUMBER() OVER(ORDER BY effective_mmr DESC,kills DESC,updated_at ASC NULLS LAST) position FROM active
    )
    SELECT r.discord_id,r.steam_id,r.status,COALESCE(x.effective_mmr,${STARTING_MMR}) effective_mmr,COALESCE(x.position,0) position
    FROM season_official_registrations r
    LEFT JOIN ranked x ON x.discord_id=r.discord_id
    WHERE r.season_key=${OFFICIAL_KEY}
  `);
  return (result?.rows||[]) as Enrolled[];
}

async function ensureRole(guild:Guild,name:string):Promise<Role|null>{
  const found=guild.roles.cache.find(role=>role.name===name);
  if(found)return found;
  return guild.roles.create({name,reason:"Guerra Fria Season 2 • progressão competitiva"}).catch(error=>{
    logger.warn({error,roleName:name},"Could not create Season 2 Discord role");
    return null;
  });
}

async function rankRoles(guild:Guild):Promise<Map<string,Role>>{
  const map=new Map<string,Role>();
  for(const rank of ranksForSeason(SEASON)){
    const role=await ensureRole(guild,`${RANK_PREFIX}${rank.name}`);
    if(role)map.set(rank.name,role);
  }
  return map;
}

async function clearSeason2Roles(member:GuildMember,registered:Role|null,roles:Map<string,Role>){
  const ids=[...roles.values()].map(role=>role.id).filter(id=>member.roles.cache.has(id));
  if(registered&&member.roles.cache.has(registered.id))ids.push(registered.id);
  if(ids.length)await member.roles.remove(ids,"Season 2 • inscrição inativa");
}

async function syncMember(member:GuildMember,row:Enrolled,registered:Role|null,roles:Map<string,Role>):Promise<boolean>{
  if(String(row.status).toLowerCase()!=="active"){
    await clearSeason2Roles(member,registered,roles);
    return true;
  }
  if(registered&&!member.roles.cache.has(registered.id))await member.roles.add(registered,"Inscrito na Guerra Fria Season 2");
  const xp=xpFromMmr(row.effective_mmr,STARTING_MMR);
  const rank=rankForSeason(SEASON,xp,row.position);
  const target=roles.get(rank.name);
  if(!target)return false;
  const rankIds=[...roles.values()].map(role=>role.id);
  const remove=rankIds.filter(id=>id!==target.id&&member.roles.cache.has(id));
  if(remove.length)await member.roles.remove(remove,`Atualização de patente Season 2 • ${rank.short}`);
  if(!member.roles.cache.has(target.id))await member.roles.add(target,`Patente Guerra Fria Season 2 • ${rank.name}`);
  return true;
}

async function syncOnce(client:Client):Promise<void>{
  if(running)return;
  running=true;
  try{
    const guildId=String(process.env.DISCORD_GUILD_ID||"").trim();
    if(!guildId)return;
    const guild=await client.guilds.fetch(guildId);
    await guild.roles.fetch().catch(error=>logger.warn({error,guildId},"Could not refresh Discord roles before Season 2 sync"));
    const registered=await ensureRole(guild,REGISTERED_ROLE_NAME);
    const roles=await rankRoles(guild);
    const rows=await enrolledPlayers();
    let changed=0,failures=0;
    for(const row of rows){
      const member=await guild.members.fetch(row.discord_id).catch(()=>null);
      if(!member||member.user.bot)continue;
      await syncMember(member,row,registered,roles).then(ok=>{if(ok)changed++;else failures++;}).catch(error=>{
        failures++;logger.warn({error,discordId:row.discord_id},"Could not sync Season 2 Discord rank");
      });
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    if(changed||failures)logger.info({tracked:rows.length,changed,failures,rankRoles:roles.size},"Season 2 Discord rank sync completed");
  }catch(error){logger.error({error},"Season 2 Discord rank sync failed");}
  finally{running=false;}
}

export function startSeason2DiscordRankSync(client:Client):void{
  if(timer)return;
  void syncOnce(client);
  timer=setInterval(()=>void syncOnce(client),60_000);
  timer.unref?.();
}
