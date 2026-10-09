import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import {
  SEASON_2_START_AT,
  rankForSeason,
  rankImage,
  rankProgressForSeason,
  ranksForSeason,
  seasonRegistrationKey,
  xpFromMmr,
} from "./seasonRanks.js";

const router: IRouter = Router();
const STARTING_MMR = 1000;
const num = (value:any, fallback=0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const integer = (value:any) => Math.trunc(num(value));
const text = (value:any, max=1000) => String(value ?? "").slice(0, max);

function achievements(row:any, position:number) {
  const list:{code:string;name:string;emoji:string;description:string}[] = [];
  const kills=integer(row.kills), headshots=integer(row.headshots);
  const raids=integer(row.raids_participated), defenses=integer(row.raids_defended);
  const events=integer(row.bradley_participations)+integer(row.heli_participations)+integer(row.crates_hacked);
  if (kills >= 1) list.push({code:"first_blood",name:"Primeiro Sangue",emoji:"🩸",description:"Registrou a primeira eliminação da Season."});
  if (kills >= 25) list.push({code:"hunter",name:"Caçador",emoji:"🎯",description:"Alcançou 25 eliminações."});
  if (headshots >= 20) list.push({code:"cold_aim",name:"Mira Fria",emoji:"❄️",description:"Alcançou 20 headshots."});
  if (raids >= 5) list.push({code:"raider",name:"Raider",emoji:"💥",description:"Participou de 5 raids."});
  if (defenses >= 3) list.push({code:"wall",name:"Muralha",emoji:"🛡️",description:"Defendeu 3 raids."});
  if (events >= 5) list.push({code:"events",name:"Veterano de Eventos",emoji:"⚡",description:"Somou 5 participações em Bradley, Heli ou crates."});
  if (position === 1) list.push({code:"front_leader",name:"Líder do Front",emoji:"👑",description:"Ocupa o Top 1 do ranking ao vivo."});
  return list;
}

function publicPlayer(seasonNumber:number,row:any,position?:number){
  const pos=position??integer(row.position);
  const xp=xpFromMmr(row.effective_mmr??row.mmr,STARTING_MMR);
  const progress=rankProgressForSeason(seasonNumber,xp,pos);
  const rank=progress.rank;
  return {
    position:pos,
    steam_id:text(row.steam_id,32),
    player_name:text(row.player_name,128),
    patente:rank.name,
    patente_codigo:rank.short,
    patente_nivel:rank.level,
    patente_imagem:rankImage(rank),
    patente_maxima:progress.isTopRank,
    general_frio:progress.isTopRank,
    xp,
    experiencia:xp,
    proxima_patente:progress.next?.name??null,
    xp_proxima_patente:progress.next?.xp??null,
    xp_faltante:progress.xpMissing,
    proxima_condicao:progress.nextCondition,
    progresso_percentual:progress.progress,
    season_scored:Boolean(row.season_scored),
    kills:integer(row.kills),
    deaths:integer(row.deaths),
    headshots:integer(row.headshots),
    assists:integer(row.assists),
    raids_participated:integer(row.raids_participated),
    raids_defended:integer(row.raids_defended),
    bradley_participations:integer(row.bradley_participations),
    heli_participations:integer(row.heli_participations),
    crates_hacked:integer(row.crates_hacked),
    sulfur_ore:integer(row.sulfur_ore),
    hqm_ore:integer(row.hqm_ore),
    conquistas:achievements(row,pos),
    updated_at:row.updated_at,
  };
}

function universe(seasonNumber:number){
  const key=seasonRegistrationKey(seasonNumber);

  // Season 2 is read from its own immutable transaction ledger instead of the
  // cumulative player snapshot. The Rust plugin can stay alive across the
  // Season 1 -> Season 2 transition and temporarily hold S1 counters in RAM;
  // using that snapshot here would leak the previous Season into the new one.
  // Every accepted event is already remapped by seasonIngestionSafe to the
  // canonical active Season, so summing S2 transactions from the official
  // start produces the correct fresh S2 score even during that rollover.
  if (seasonNumber === 2) {
    return sql`
      WITH registered AS (
        SELECT steam_id,discord_name,created_at
        FROM season_official_registrations
        WHERE season_key=${key} AND status='active' AND NULLIF(TRIM(steam_id),'') IS NOT NULL
      ),
      ledger AS (
        SELECT
          steam_id,
          (ARRAY_AGG(player_name ORDER BY happened_at DESC))[1] player_name,
          COALESCE(SUM(final_value),0) delta,
          COUNT(*) FILTER (WHERE event_type='KILL')::int kills,
          COUNT(*) FILTER (
            WHERE event_type='KILL' AND (
              LOWER(COALESCE(details,'')) LIKE '%headshot=true%' OR
              LOWER(COALESCE(details,'')) LIKE '%headshot: true%' OR
              LOWER(COALESCE(details,'')) LIKE '%headshot%'
            )
          )::int headshots,
          COUNT(*) FILTER (WHERE event_type='RAID_SESSION_COMPLETE')::int raids_participated,
          COUNT(*) FILTER (WHERE event_type='RAID_DEFENDED')::int raids_defended,
          COUNT(*) FILTER (WHERE event_type ILIKE '%BRADLEY%')::int bradley_participations,
          COUNT(*) FILTER (WHERE event_type ILIKE '%HELI%')::int heli_participations,
          COUNT(*) FILTER (WHERE event_type ILIKE '%CRATE%')::int crates_hacked,
          COALESCE(SUM(CASE WHEN event_type ILIKE '%SULFUR%' THEN GREATEST(base_value,0) ELSE 0 END),0)::bigint sulfur_ore,
          COALESCE(SUM(CASE WHEN event_type ILIKE '%HQM%' THEN GREATEST(base_value,0) ELSE 0 END),0)::bigint hqm_ore,
          MAX(received_at) updated_at
        FROM season_transactions
        WHERE season_number=2
          AND happened_at >= ${new Date(SEASON_2_START_AT)}
        GROUP BY steam_id
      ),
      u AS (
        SELECT
          r.steam_id,
          COALESCE(NULLIF(l.player_name,''),r.discord_name,r.steam_id) player_name,
          ${STARTING_MMR}::double precision mmr,
          COALESCE(l.delta,0)::double precision ledger_delta,
          COALESCE(l.kills,0) kills,
          0::int deaths,
          COALESCE(l.headshots,0) headshots,
          0::int assists,
          COALESCE(l.raids_participated,0) raids_participated,
          COALESCE(l.raids_defended,0) raids_defended,
          COALESCE(l.bradley_participations,0) bradley_participations,
          COALESCE(l.heli_participations,0) heli_participations,
          COALESCE(l.crates_hacked,0) crates_hacked,
          COALESCE(l.sulfur_ore,0) sulfur_ore,
          COALESCE(l.hqm_ore,0) hqm_ore,
          COALESCE(l.updated_at,r.created_at) updated_at,
          (l.steam_id IS NOT NULL) season_scored
        FROM registered r
        LEFT JOIN ledger l ON l.steam_id=r.steam_id
      ),
      ranked AS (
        SELECT
          u.*,
          ${STARTING_MMR}+u.ledger_delta effective_mmr,
          ROW_NUMBER() OVER(
            ORDER BY ${STARTING_MMR}+u.ledger_delta DESC,u.kills DESC,u.updated_at ASC NULLS LAST
          ) position
        FROM u
      )
      SELECT * FROM ranked
    `;
  }

  if (seasonNumber === 1) {
    return sql`
      WITH adjustments AS (
        SELECT steam_id,COALESCE(SUM(final_value),0) delta
        FROM season_transactions
        WHERE season_number=${seasonNumber} AND category='admin'
        GROUP BY steam_id
      ),
      sd AS (
        SELECT * FROM season_players WHERE season_number=${seasonNumber}
      ),
      registered AS (
        SELECT steam_id,discord_name,created_at
        FROM season_official_registrations
        WHERE season_key=${key} AND status='active' AND NULLIF(TRIM(steam_id),'') IS NOT NULL
      ),
      u AS (
        SELECT r.steam_id,
          COALESCE(NULLIF(sd.player_name,''),r.discord_name,r.steam_id) player_name,
          COALESCE(sd.mmr,${STARTING_MMR}) mmr,
          COALESCE(sd.kills,0) kills,COALESCE(sd.deaths,0) deaths,
          COALESCE(sd.headshots,0) headshots,COALESCE(sd.assists,0) assists,
          COALESCE(sd.raids_participated,0) raids_participated,
          COALESCE(sd.raids_defended,0) raids_defended,
          COALESCE(sd.bradley_participations,0) bradley_participations,
          COALESCE(sd.heli_participations,0) heli_participations,
          COALESCE(sd.crates_hacked,0) crates_hacked,
          COALESCE(sd.sulfur_ore,0) sulfur_ore,COALESCE(sd.hqm_ore,0) hqm_ore,
          COALESCE(sd.updated_at,r.created_at) updated_at,
          (sd.steam_id IS NOT NULL) season_scored
        FROM registered r
        LEFT JOIN sd ON sd.steam_id=r.steam_id
      ),
      ranked AS (
        SELECT u.*,u.mmr+COALESCE(a.delta,0) effective_mmr,
          ROW_NUMBER() OVER(ORDER BY u.mmr+COALESCE(a.delta,0) DESC,u.kills DESC,u.updated_at ASC NULLS LAST) position
        FROM u
        LEFT JOIN adjustments a ON a.steam_id=u.steam_id
      )
      SELECT * FROM ranked
    `;
  }

  return sql`
    WITH adjustments AS (
      SELECT steam_id,COALESCE(SUM(final_value),0) delta
      FROM season_transactions
      WHERE season_number=${seasonNumber} AND category='admin'
      GROUP BY steam_id
    ),
    ranked AS (
      SELECT p.*,p.mmr+COALESCE(a.delta,0) effective_mmr,true season_scored,
        ROW_NUMBER() OVER(ORDER BY p.mmr+COALESCE(a.delta,0) DESC,p.kills DESC,p.updated_at ASC NULLS LAST) position
      FROM season_players p
      LEFT JOIN adjustments a ON a.steam_id=p.steam_id
      WHERE p.season_number=${seasonNumber}
    )
    SELECT * FROM ranked
  `;
}

function leader(ranking:any[], title:string, emoji:string, value:(p:any)=>number, suffix:string){
  if (!ranking.length) return null;
  const sorted=[...ranking].sort((a,b)=>value(b)-value(a)||a.position-b.position);
  const player=sorted[0];
  const amount=value(player);
  if (amount <= 0) return null;
  return {title,emoji,value:amount,value_label:`${amount.toLocaleString("pt-BR")} ${suffix}`,player:{
    position:player.position,steam_id:player.steam_id,player_name:player.player_name,
    patente:player.patente,patente_imagem:player.patente_imagem,xp:player.xp
  }};
}

function categoryLeaders(ranking:any[]){
  return [
    leader(ranking,"Dominador PvP","🎯",p=>p.kills,"kills"),
    leader(ranking,"Mira Fria","❄️",p=>p.headshots,"headshots"),
    leader(ranking,"Comando de Raid","💥",p=>p.raids_participated+p.raids_defended,"ações de raid"),
    leader(ranking,"Veterano de Eventos","⚡",p=>p.bradley_participations+p.heli_participations+p.crates_hacked,"eventos"),
  ].filter(Boolean);
}

router.get("/season/:number",async(req,res,next)=>{
  if(!/^\d+$/.test(String(req.params.number||""))) return next();
  try{
    const seasonNumber=Math.max(1,integer(req.params.number)||1);
    const rr:any=await db.execute(sql`${universe(seasonNumber)} ORDER BY position ASC`);
    const ranking=(rr?.rows||[]).map((row:any,index:number)=>publicPlayer(seasonNumber,row,index+1));
    const ranks=ranksForSeason(seasonNumber).map(rank=>({...rank,image:rankImage(rank)}));
    res.setHeader("Cache-Control","no-store");
    return void res.json({
      ok:true,
      season_number:seasonNumber,
      data_source_season_number:seasonNumber,
      total_players:ranking.length,
      registered_only:seasonNumber<=2,
      methodology:{
        metric:"Experiência",
        description:seasonNumber>=2
          ?"A Season 2 possui 15 patentes. A progressão depende exclusivamente dos eventos registrados a partir do início oficial da Season 2; General Frio exige 10.000 XP e Top 1."
          :"Soldado, Tenente, Major e Marechal dependem de XP. General Frio exige Marechal e Top 1."
      },
      ranks,
      general_count:ranking.filter((p:any)=>p.general_frio).length,
      category_leaders:seasonNumber>=2?categoryLeaders(ranking):[],
      ranking
    });
  }catch(error){
    logger.error({error},"season XP ranking failed");
    return void res.status(500).json({error:"Falha ao carregar ranking da Season."});
  }
});

router.get("/season/:number/player/:steamId",async(req,res,next)=>{
  const id=text(req.params.steamId,32);
  if(!/^7656119\d{10}$/.test(id)) return next();
  try{
    const seasonNumber=Math.max(1,integer(req.params.number)||1);
    const pr:any=await db.execute(sql`${universe(seasonNumber)} WHERE steam_id=${id} LIMIT 1`);
    const tx:any=await db.execute(sql`
      SELECT category,event_type,
        CASE WHEN final_value>0 THEN 'gain' WHEN final_value<0 THEN 'loss' ELSE 'neutral' END direction,
        ROUND(final_value*9)::int xp_change,details,happened_at
      FROM season_transactions
      WHERE season_number=${seasonNumber} AND steam_id=${id}
        AND (${seasonNumber}<>2 OR happened_at >= ${new Date(SEASON_2_START_AT)})
      ORDER BY happened_at DESC LIMIT 100
    `);
    const player=pr?.rows?.[0]?publicPlayer(seasonNumber,pr.rows[0],integer(pr.rows[0].position)):null;
    return void res.json({
      ok:true,season_number:seasonNumber,player,
      transactions:player?(tx?.rows||[]):[],
      ranks:ranksForSeason(seasonNumber).map(rank=>({...rank,image:rankImage(rank)}))
    });
  }catch(error){
    logger.error({error},"season XP player failed");
    return void res.status(500).json({error:"Falha ao carregar jogador da Season."});
  }
});

export default router;
