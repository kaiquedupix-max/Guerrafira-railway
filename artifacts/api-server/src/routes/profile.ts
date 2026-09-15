import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getCommunitySession } from "../admin/communitySession.js";
import { withSiteChrome } from "../admin/siteChrome.js";
import { getLinkedSteamV2 } from "../bot/utils/linkedSteamV2.js";

const router: IRouter = Router();
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c] || c));
const num = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
const pt = (v: unknown) => Math.trunc(num(v)).toLocaleString("pt-BR");
const date = (v: unknown) => {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat("pt-BR", { timeZone:"America/Sao_Paulo", day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" }).format(d) : "—";
};
const row = (r: any) => Array.isArray(r?.rows) ? r.rows[0] ?? null : null;

function remaining(expiresAt: unknown): string {
  const ms = new Date(String(expiresAt)).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "Expirado";
  const days = Math.floor(ms / 86400000), hours = Math.floor((ms % 86400000) / 3600000);
  return days > 0 ? `${days}d ${hours}h restantes` : `${Math.max(1, hours)}h restantes`;
}

async function loadProfile(discordUserId: string) {
  const linked = await getLinkedSteamV2(discordUserId).catch(() => null);
  const steamId = linked?.steamId && /^7656119\d{10}$/.test(linked.steamId) ? linked.steamId : null;
  const vipResult: any = await db.execute(sql`
    SELECT vip_tier, source, duration_days, starts_at, expires_at
    FROM vip_subscriptions
    WHERE discord_user_id=${discordUserId}
      AND expires_at > now()
      AND discord_role_removed=false
      AND game_vip_removed=false
    ORDER BY expires_at DESC LIMIT 1
  `).catch(() => null);
  const vip = row(vipResult);
  let stats: any = null;
  if (steamId) {
    const statsResult: any = await db.execute(sql`
      SELECT ps.*, p.is_online, p.first_seen, p.last_seen
      FROM player_stats ps
      LEFT JOIN players p ON p.steam_id=ps.steam_id
      WHERE ps.steam_id=${steamId}
      LIMIT 1
    `).catch(() => null);
    stats = row(statsResult);
    if (!stats) {
      const playerResult: any = await db.execute(sql`SELECT steam_id,player_name,is_online,first_seen,last_seen FROM players WHERE steam_id=${steamId} LIMIT 1`).catch(() => null);
      stats = row(playerResult);
    }
  }
  return { linked, steamId, vip, stats };
}

function renderProfile(username: string, data: Awaited<ReturnType<typeof loadProfile>>): string {
  const { steamId, vip, stats } = data;
  const initial = esc(username.charAt(0).toUpperCase() || "G");
  const playerName = esc(stats?.player_name || username);
  const kills = num(stats?.kills), deaths = num(stats?.deaths), headshots = num(stats?.headshots);
  const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);
  const hs = kills > 0 ? Math.round((headshots / kills) * 100) : 0;
  const farm = num(stats?.resources_gathered) || (num(stats?.wood_gathered) + num(stats?.stone_gathered) + num(stats?.metal_ore_gathered) + num(stats?.sulfur_ore_gathered));
  const online = stats?.is_online === true;
  const vipTier = vip ? String(vip.vip_tier || "VIP").toUpperCase() : "SEM VIP";
  const vipText = vip ? remaining(vip.expires_at) : "Nenhum VIP ativo";
  const steamSafe = steamId ? esc(steamId) : "NÃO VINCULADA";
  const seasonScriptSteam = JSON.stringify(steamId || "");

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#050708"><title>Meu Perfil • Guerra Fria</title><style>
:root{--orange:#ffb000;--green:#35da86;--bg:#050708;--panel:#090d0f;--line:#293238;--muted:#8d959a;--text:#f4f2ed}*{box-sizing:border-box}body{margin:0;background:#050708;color:var(--text);font-family:Arial,Helvetica,sans-serif}.profilePage{width:min(1594px,87.4%);margin:auto;padding:38px 0 72px}.profileHero{display:grid;grid-template-columns:1fr auto;gap:28px;align-items:end;padding:42px 38px!important;margin-bottom:15px!important}.profileEy{font-size:9px;letter-spacing:.22em;font-weight:950;color:var(--orange)}.profileHero h1{font-family:Impact,"Arial Narrow",Arial,sans-serif;font-size:clamp(48px,6vw,82px);line-height:.9;margin:12px 0 10px;text-transform:uppercase}.profileHero h1 em{font-style:normal;color:var(--orange)}.profileHero p{max-width:680px;color:#9aa0a4;font-size:13px;line-height:1.6}.profileIdentity{display:flex;align-items:center;gap:14px;min-width:250px}.profileAvatar{width:68px;height:68px;border:1px solid #8a5a0f;background:linear-gradient(135deg,#ffc52c,#ff9300);color:#070809;display:grid;place-items:center;font-family:Impact,Arial,sans-serif;font-size:30px}.profileIdentity small{display:block;color:#717a80;font-size:8px;letter-spacing:.13em}.profileIdentity b{display:block;margin-top:5px;font-size:16px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.statusLine{display:flex;align-items:center;gap:7px;color:${online?'#63e9a2':'#858d92'};font-size:8px;margin-top:6px}.statusLine i{width:7px;height:7px;border-radius:50%;background:${online?'var(--green)':'#565e63'}}.profileGrid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px}.pCard{grid-column:span 4;border:1px solid var(--line);background:linear-gradient(145deg,#0b1114,#060b0e);padding:22px;min-height:188px}.pCard.wide{grid-column:span 8}.pCard.full{grid-column:1/-1}.pCard.vip{border-color:${vip?'#8a5a0f':'#293238'}}.pTop{display:flex;align-items:center;justify-content:space-between;gap:12px}.pLabel{color:#778087;font-size:8px;font-weight:950;letter-spacing:.16em}.pIcon{width:38px;height:38px;border:1px solid #293238;background:#0e1417;display:grid;place-items:center;font-size:17px}.pValue{font-family:Impact,"Arial Narrow",Arial,sans-serif;font-size:32px;margin-top:20px;line-height:1;color:#f4f2ed}.vip .pValue,.season .pValue{color:var(--orange)}.pSub{color:#848d92;font-size:10px;line-height:1.55;margin-top:8px}.miniGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-top:18px}.mini{border-top:1px solid #20272b;padding-top:12px}.mini small{display:block;color:#6f787e;font-size:7px;letter-spacing:.1em}.mini b{display:block;margin-top:5px;font-size:13px}.progressTrack{height:8px;background:#151a1e;margin-top:16px;overflow:hidden}.progressFill{height:100%;width:0;background:linear-gradient(90deg,#ff8a00,#ffbd0a);transition:width .6s}.actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:18px}.action{min-height:42px;padding:0 14px;border:1px solid #343d42;background:#090d0f;color:#f4f2ed;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:950;letter-spacing:.08em}.action.primary{background:linear-gradient(120deg,#ffba08,#ffa800);border-color:#ffc326;color:#070809}.activity{margin-top:12px}.activityRow{display:grid;grid-template-columns:1fr auto;gap:14px;padding:12px 0;border-top:1px solid #20272b}.activityRow b{font-size:10px}.activityRow small{display:block;color:#788086;font-size:8px;margin-top:4px}.activityXp{font-weight:950;font-size:10px;color:#d6d9d7}.activityXp.gain{color:#54df95}.activityXp.loss{color:#ef7777}.empty{color:#70797f;font-size:10px;padding:16px 0}.steamId{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:14px!important;word-break:break-all}.footerNote{text-align:center;color:#50595e;font-size:8px;padding-top:24px}@media(max-width:1100px){.pCard{grid-column:span 6}.pCard.wide{grid-column:span 12}}@media(max-width:700px){.profilePage{width:calc(100% - 28px);padding-top:24px}.profileHero{grid-template-columns:1fr;padding:28px 20px!important}.profileIdentity{min-width:0}.pCard,.pCard.wide{grid-column:1/-1;padding:18px}.miniGrid{grid-template-columns:1fr 1fr}.profileHero h1{font-size:48px}}
</style></head><body><main class="profilePage"><section class="hero profileHero"><div><div class="profileEy">GUERRA FRIA • CONTA DO JOGADOR</div><h1>MEU <em>PERFIL</em></h1><p>Seu resumo no Guerra Fria: benefícios, vínculo Steam, desempenho e progresso competitivo da Season em um só lugar.</p></div><div class="profileIdentity"><div class="profileAvatar">${initial}</div><div><small>CONTA DISCORD</small><b>${esc(username)}</b><div class="statusLine"><i></i><span>${online?'ONLINE NO SERVIDOR':'OFFLINE NO SERVIDOR'}</span></div></div></div></section><section class="profileGrid">
<div class="pCard vip"><div class="pTop"><span class="pLabel">VIP ATUAL</span><span class="pIcon">◆</span></div><div class="pValue">${esc(vipTier)}</div><div class="pSub">${esc(vipText)}${vip?`<br>Expira em ${esc(date(vip.expires_at))}`:""}</div><div class="actions"><a class="action primary" href="/loja">VER LOJA VIP</a></div></div>
<div class="pCard season"><div class="pTop"><span class="pLabel">SEASON ATUAL</span><span class="pIcon">🏆</span></div><div class="pValue" id="seasonRank">${steamId?'CARREGANDO…':'SEM STEAM'}</div><div class="pSub" id="seasonSub">${steamId?'Buscando sua classificação oficial.':'Vincule sua Steam para aparecer no ranking.'}</div><div class="progressTrack"><div class="progressFill" id="seasonProgress"></div></div><div class="actions"><a class="action" href="/season1">ABRIR SEASON</a></div></div>
<div class="pCard"><div class="pTop"><span class="pLabel">STEAM VINCULADA</span><span class="pIcon">◉</span></div><div class="pValue steamId">${steamSafe}</div><div class="pSub">${steamId?`Jogador: <b>${playerName}</b><br>Último acesso: ${esc(date(stats?.last_seen))}`:'Sua Steam ainda não está associada à conta.'}</div></div>
<div class="pCard wide"><div class="pTop"><span class="pLabel">DESEMPENHO</span><span class="pIcon">⚔</span></div><div class="miniGrid"><div class="mini"><small>KILLS</small><b id="statKills">${pt(kills)}</b></div><div class="mini"><small>DEATHS</small><b id="statDeaths">${pt(deaths)}</b></div><div class="mini"><small>K/D</small><b>${kd}</b></div><div class="mini"><small>HEADSHOTS</small><b>${pt(headshots)} • ${hs}%</b></div><div class="mini"><small>FARM TOTAL</small><b>${pt(farm)}</b></div><div class="mini"><small>C4 USADOS</small><b>${pt(stats?.c4_used)}</b></div><div class="mini"><small>ROCKETS</small><b>${pt(stats?.rockets_used)}</b></div><div class="mini"><small>NO GUERRA FRIA DESDE</small><b>${esc(date(stats?.first_seen))}</b></div></div></div>
<div class="pCard"><div class="pTop"><span class="pLabel">PATENTE</span><span class="pIcon">🎖</span></div><div class="pValue" id="seasonPatent">—</div><div class="pSub" id="seasonXp">Aguardando dados da Season.</div></div>
<div class="pCard full"><div class="pTop"><span class="pLabel">ATIVIDADES RECENTES DA SEASON</span><span class="pIcon">↗</span></div><div class="activity" id="recentActivity"><div class="empty">${steamId?'Carregando atividades…':'Sem Steam vinculada para consultar atividades.'}</div></div><div class="actions"><a class="action" href="/leaderboard">LEADERBOARD</a><a class="action" href="/api/status">STATUS DO SERVIDOR</a><a class="action" href="/auditoria">AUDITORIA</a></div></div>
</section><div class="footerNote">GUERRA FRIA • PERFIL PRIVADO DA SUA CONTA</div></main><script>
(()=>{const steam=${seasonScriptSteam};if(!steam)return;const f=v=>Number(v||0).toLocaleString('pt-BR'),e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));fetch('/api/season/1/player/'+encodeURIComponent(steam)+'?_='+Date.now(),{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(d=>{const p=d.player;if(!p){document.getElementById('seasonRank').textContent='FORA DO RANKING';document.getElementById('seasonSub').textContent='Ainda não há classificação ativa para esta Steam.';document.getElementById('seasonPatent').textContent='Soldado';document.getElementById('seasonXp').textContent='0 XP';return;}document.getElementById('seasonRank').textContent='#'+f(p.position);document.getElementById('seasonSub').textContent=(p.patente||'Soldado')+' • '+f(p.xp)+' XP';document.getElementById('seasonPatent').textContent=p.patente||'Soldado';document.getElementById('seasonXp').textContent=f(p.xp)+' XP'+(p.proxima_patente?' • faltam '+f(p.xp_faltante)+' para '+p.proxima_patente:(p.general_frio?' • Top 1 / General Frio':' • Marechal'));document.getElementById('seasonProgress').style.width=Math.max(0,Math.min(100,Number(p.progresso_percentual||0)))+'%';document.getElementById('statKills').textContent=f(p.kills);document.getElementById('statDeaths').textContent=f(p.deaths);const tx=(d.transactions||[]).slice(0,6);document.getElementById('recentActivity').innerHTML=tx.length?tx.map(t=>'<div class="activityRow"><div><b>'+e(t.event_type||t.category||'Atividade')+'</b><small>'+e(t.details||'Atividade registrada')+'</small></div><div class="activityXp '+(t.direction==='gain'?'gain':t.direction==='loss'?'loss':'')+'">'+(Number(t.xp_change)>0?'+':'')+f(t.xp_change)+' XP</div></div>').join(''):'<div class="empty">Nenhuma atividade recente registrada.</div>';}).catch(()=>{document.getElementById('seasonRank').textContent='INDISPONÍVEL';document.getElementById('seasonSub').textContent='Não foi possível consultar a Season agora.';document.getElementById('recentActivity').innerHTML='<div class="empty">Dados da Season temporariamente indisponíveis.</div>';});})();
</script></body></html>`;
}

router.get("/perfil", async (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return res.redirect("/api/admin/auth/login?target=home");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  const data = await loadProfile(session.userId);
  return res.status(200).type("html").send(withSiteChrome(renderProfile(session.username, data), "profile", { isAdmin:session.isAdmin, username:session.username }));
});

export default router;
