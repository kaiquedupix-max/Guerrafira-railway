import type { CommunitySession } from "../admin/communitySession.js";

const registrationForm = `
<div class="bi-form-heading"><div><span class="eyebrow">INSCRIÇÃO OFICIAL</span><h2>Escolha como quer participar.</h2><p>Inscreva um trio completo ou cadastre-se sozinho. Os jogadores sem equipe serão reunidos em trios sorteados pela organização no dia do evento.</p></div><b class="free">GRÁTIS</b></div>
<form id="bi-form" class="bi-form" autocomplete="on">
  <div class="bi-choices" role="group" aria-label="Modalidade de inscrição">
    <label class="bi-choice"><input type="radio" name="registrationMode" value="trio" checked><span><strong>TRIO FECHADO</strong><small>Já tenho uma equipe com três jogadores.</small></span></label>
    <label class="bi-choice"><input type="radio" name="registrationMode" value="random"><span><strong>INSCRIÇÃO ALEATÓRIA</strong><small>Não tenho equipe e quero participar do sorteio no dia do evento.</small></span></label>
  </div>
  <fieldset id="bi-trio-fields" class="bi-mode-panel">
  <label>Nome da equipe<input name="teamName" maxlength="36" minlength="3" placeholder="Ex.: Frost Raiders" required></label>
  <div class="players">
    <div class="player"><strong><span>01</span> Jogador 1</strong><label>Nome no Rust<input name="name1" maxlength="32" minlength="2" required placeholder="Nick do primeiro jogador"></label><label>SteamID64<input name="steam1" inputmode="numeric" pattern="7656119[0-9]{10}" maxlength="17" required placeholder="7656119xxxxxxxxxx"></label></div>
    <div class="player"><strong><span>02</span> Jogador 2</strong><label>Nome no Rust<input name="name2" maxlength="32" minlength="2" required placeholder="Nick do segundo jogador"></label><label>SteamID64<input name="steam2" inputmode="numeric" pattern="7656119[0-9]{10}" maxlength="17" required placeholder="7656119xxxxxxxxxx"></label></div>
    <div class="player"><strong><span>03</span> Jogador 3</strong><label>Nome no Rust<input name="name3" maxlength="32" minlength="2" required placeholder="Nick do terceiro jogador"></label><label>SteamID64<input name="steam3" inputmode="numeric" pattern="7656119[0-9]{10}" maxlength="17" required placeholder="7656119xxxxxxxxxx"></label></div>
  </div>
  </fieldset>
  <fieldset id="bi-random-fields" class="bi-mode-panel" hidden disabled>
    <p class="bi-random-notice">Sem trio? Inscreva-se individualmente com seu nick e SteamID64. <strong>No dia do evento</strong>, a organização sorteará os inscritos nesta modalidade para montar as equipes de três jogadores.</p>
    <div class="bi-solo-fields"><label>Seu nick no Rust<input name="soloName" maxlength="32" minlength="2" required placeholder="Seu nome no Rust"></label><label>Seu SteamID64<input name="soloSteamId" inputmode="numeric" pattern="7656119[0-9]{10}" maxlength="17" required placeholder="7656119xxxxxxxxxx"></label></div>
  </fieldset>
  <label class="agreement"><input type="checkbox" name="accept" required><span>Li e aceito as regras do evento. Para trio fechado, confirmo que os três jogadores concordaram em participar. Para inscrição aleatória, entendo que minha equipe será definida no dia do evento.</span></label>
  <button id="bi-submit" type="submit">CONFIRMAR INSCRIÇÃO GRATUITA <span>↗</span></button>
  <p class="bi-msg" id="bi-msg" role="status" aria-live="polite"></p>
</form>
<script>
(()=>{const form=document.getElementById('bi-form');if(!form)return;const msg=document.getElementById('bi-msg'),btn=document.getElementById('bi-submit'),trio=document.getElementById('bi-trio-fields'),random=document.getElementById('bi-random-fields');const set=(s,ok)=>{msg.textContent=s;msg.style.color=ok?'#8eebac':'#ffb5ac'};const sync=()=>{const isRandom=form.querySelector('input[name="registrationMode"]:checked').value==='random';trio.hidden=isRandom;trio.disabled=isRandom;random.hidden=!isRandom;random.disabled=!isRandom};form.querySelectorAll('input[name="registrationMode"]').forEach(input=>input.addEventListener('change',sync));sync();fetch('/api/base-invaders/minha-inscricao',{credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(d=>{if(d?.registration){const reg=d.registration;set(reg.registration_mode==='random'?'Você já se inscreveu na modalidade aleatória. Seu trio será sorteado no dia do evento.':'Você já inscreveu a equipe '+reg.team_name+'.',true);btn.disabled=true;const a=document.createElement('a');a.href='/base-invaders/inscricao-confirmada';a.textContent='VER MINHA INSCRIÇÃO ↗';a.className='bi-confirm-link';msg.after(a)}}).catch(()=>{});form.addEventListener('submit',async e=>{e.preventDefault();btn.disabled=true;set('Registrando sua inscrição...',true);const f=new FormData(form),registrationMode=String(f.get('registrationMode')||'trio'),players=registrationMode==='random'?[{name:String(f.get('soloName')||'').trim(),steamId:String(f.get('soloSteamId')||'').trim()}]:[1,2,3].map(i=>({name:String(f.get('name'+i)||'').trim(),steamId:String(f.get('steam'+i)||'').trim()}));try{const r=await fetch('/api/base-invaders/inscricoes',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({registrationMode,teamName:String(f.get('teamName')||'').trim(),players,acceptRules:f.get('accept')==='on'})});const d=await r.json();if(!r.ok)throw Error(d.error||'Falha na inscrição.');window.location.assign('/base-invaders/inscricao-confirmada')}catch(error){set(error.message||'Erro ao realizar inscrição.',false);btn.disabled=false;}})})();
</script>
`;

const loginForm = `
<div class="bi-login"><span class="eyebrow">INSCRIÇÕES GRATUITAS</span><h2>Com trio ou sem equipe, participe!</h2><p>Entre com seu Discord vinculado à Guerra Fria. Você pode inscrever um trio pronto ou participar individualmente do sorteio de equipes, realizado no dia do evento.</p><a href="/api/admin/auth/login?target=base-invaders">ENTRAR COM DISCORD PARA INSCREVER-SE ↗</a><small>Sem taxa de inscrição. Não é necessário realizar pagamento.</small></div>
`;

const adminSection = `<section class="bi-admin" id="bi-admin" aria-label="Aprovação de inscrições">
<style>
.bi-admin{margin-top:56px;padding:clamp(20px,4vw,36px);border:1px solid #3a3a2a;border-radius:16px;background:#0f1514}
.bi-admin-head{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;justify-content:space-between}
.bi-admin-head h2{margin:6px 0 0;font-size:clamp(22px,3vw,30px);letter-spacing:-.02em}
.bi-admin-tabs{display:flex;gap:8px;flex-wrap:wrap}
.bi-tab{background:transparent;color:#c9d3cf;border:1px solid #3c4a46;border-radius:999px;padding:8px 14px;font-size:12px;font-weight:800;cursor:pointer}
.bi-tab[aria-pressed="true"]{background:#f0b63f;color:#14110c;border-color:#f0b63f}
.bi-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:22px 0}
.bi-stat{padding:14px 16px;border:1px solid #2c3a37;border-radius:10px;background:#0b1111}
.bi-stat b{display:block;font-size:24px}
.bi-stat small{color:#8f9e9d;font-size:11px;text-transform:uppercase;letter-spacing:.08em}
.bi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
.bi-card{display:flex;flex-direction:column;gap:12px;padding:18px;border:1px solid #2c3a37;border-radius:12px;background:#111918}
.bi-card-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.bi-card h3{margin:0;font-size:17px;line-height:1.25;word-break:break-word}
.bi-pills{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.bi-meta{color:#8f9e9d;font-size:12px;line-height:1.5}
.bi-pill{display:inline-block;padding:4px 10px;border-radius:999px;font-size:10px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
.bi-pill-pending{background:#3a2e10;color:#ffd478}
.bi-pill-approved{background:#15331f;color:#8ff0b0}
.bi-pill-rejected{background:#3a1717;color:#ffb3ab}
.bi-pill-solo{background:#1c2a3a;color:#9fd0ff}
.bi-pill-trio{background:#2a2a14;color:#f5e08a}
.bi-players{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.bi-players li{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 10px;background:#0b1111;border-radius:8px;font-size:13px}
.bi-players code{color:#8f9e9d;font-size:12px;white-space:nowrap}
.bi-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:auto;padding-top:4px}
.bi-btn{border:0;border-radius:8px;padding:9px 14px;font-weight:900;font-size:12px;cursor:pointer;color:#fff}
.bi-btn-ok{background:#2f9b5a}
.bi-btn-no{background:#8f2d2d}
.bi-btn-back{background:#2c3a37;color:#e6ece9}
.bi-btn:disabled{opacity:.5;cursor:default}
.bi-empty{grid-column:1/-1;color:#8f9e9d;padding:28px;text-align:center;border:1px dashed #33403d;border-radius:12px}
.bi-admin-msg{min-height:20px;color:#ffb5ac;font-size:13px;margin:12px 0 0}
@media(max-width:700px){.bi-stats{grid-template-columns:repeat(2,1fr)}.bi-card-top{flex-direction:column}.bi-pills{justify-content:flex-start}}
</style>
<div class="bi-admin-head">
  <div><span class="eyebrow">ADMINISTRAÇÃO</span><h2>Aprovação de inscrições</h2></div>
  <div class="bi-admin-tabs" role="group" aria-label="Filtrar inscrições">
    <button type="button" class="bi-tab" data-filter="pending" aria-pressed="true">Pendentes</button>
    <button type="button" class="bi-tab" data-filter="approved" aria-pressed="false">Aprovadas</button>
    <button type="button" class="bi-tab" data-filter="rejected" aria-pressed="false">Rejeitadas</button>
    <button type="button" class="bi-tab" data-filter="all" aria-pressed="false">Todas</button>
    <button type="button" class="bi-tab" id="bi-admin-refresh">Atualizar</button>
  </div>
</div>
<div class="bi-stats" id="bi-admin-stats"></div>
<div class="bi-grid" id="bi-admin-grid"></div>
<p class="bi-admin-msg" id="bi-admin-msg" role="status" aria-live="polite"></p>
</section>
<script>
(()=>{
  const root=document.getElementById('bi-admin');
  if(!root)return;
  const grid=document.getElementById('bi-admin-grid');
  const stats=document.getElementById('bi-admin-stats');
  const msg=document.getElementById('bi-admin-msg');
  const tabs=root.querySelectorAll('.bi-tab[data-filter]');
  const LABEL={pending:'Pendente',approved:'Aprovada',rejected:'Rejeitada'};
  let all=[];
  let filter='pending';
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
  const fmtDate=s=>{const d=new Date(s);return isNaN(d)?'':d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})};

  function renderStats(){
    const c={pending:0,approved:0,rejected:0};
    for(const t of all)c[t.status]=(c[t.status]||0)+1;
    const items=[['Total',all.length],['Pendentes',c.pending],['Aprovadas',c.approved],['Rejeitadas',c.rejected]];
    stats.replaceChildren(...items.map(([label,value])=>{const box=el('div','bi-stat');box.append(el('b','',String(value)),el('small','',label));return box}));
  }

  function card(t){
    const random=t.registration_mode==='random';
    const article=el('article','bi-card');
    const top=el('div','bi-card-top');
    top.append(el('h3','',random?'Inscrição aleatória':t.team_name));
    const pills=el('div','bi-pills');
    pills.append(el('span','bi-pill '+(random?'bi-pill-solo':'bi-pill-trio'),random?'Solo':'Trio'));
    pills.append(el('span','bi-pill bi-pill-'+t.status,LABEL[t.status]||t.status));
    top.append(pills);
    const meta=el('div','bi-meta','Capitão: '+t.captain_discord_name+' • #'+t.id+' • '+fmtDate(t.created_at));
    const list=el('ul','bi-players');
    for(const p of (Array.isArray(t.players)?t.players:[])){
      const li=el('li');
      li.append(el('span','',p.name),el('code','',p.steamId));
      list.append(li);
    }
    const actions=el('div','bi-actions');
    const button=(label,cls,next)=>{const b=el('button','bi-btn '+cls,label);b.type='button';b.addEventListener('click',()=>setStatus(t.id,next,b));return b};
    if(t.status!=='approved')actions.append(button('Aprovar','bi-btn-ok','approved'));
    if(t.status!=='rejected')actions.append(button('Rejeitar','bi-btn-no','rejected'));
    if(t.status!=='pending')actions.append(button('Voltar a pendente','bi-btn-back','pending'));
    article.append(top,meta,list,actions);
    return article;
  }

  function render(){
    renderStats();
    const list=all.filter(t=>filter==='all'||t.status===filter);
    if(!list.length){grid.replaceChildren(el('div','bi-empty','Nenhuma inscrição nesta lista.'))}
    else{grid.replaceChildren(...list.map(card))}
    tabs.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===filter)));
  }

  async function load(){
    msg.textContent='';
    try{
      const r=await fetch('/api/base-invaders/inscricoes',{credentials:'same-origin'});
      const j=await r.json();
      if(!r.ok)throw Error(j.error||'Falha ao carregar as inscrições.');
      all=j.teams||[];
      render();
    }catch(e){msg.textContent=e.message||'Falha ao carregar as inscrições.'}
  }

  async function setStatus(id,status,btn){
    btn.disabled=true;
    msg.textContent='';
    try{
      const r=await fetch('/api/base-invaders/inscricoes/'+encodeURIComponent(id)+'/status',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});
      const j=await r.json();
      if(!r.ok)throw Error(j.error||'Falha ao atualizar a inscrição.');
      const t=all.find(x=>x.id===id);
      if(t)t.status=status;
      render();
    }catch(e){msg.textContent=e.message||'Falha ao atualizar a inscrição.';btn.disabled=false}
  }

  tabs.forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;render()}));
  document.getElementById('bi-admin-refresh').addEventListener('click',load);
  load();
})();
</script>
`;

export function renderBaseInvadersPage(session: CommunitySession | null): string {
  const html = String.raw`<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Guerra Fria Invaders: inscrição por trio fechado ou aleatória para quem não tem equipe. Sorteio de trios no dia do evento. Grátis."><title>Guerra Fria Invaders | Guerra Fria Rust</title>
<style>
:root{color-scheme:dark;font-family:Inter,Arial,Helvetica,sans-serif;background:#07090b;color:#f3f5f3}*{box-sizing:border-box}body{margin:0;background:#07090b;color:#f2f3f1}a{color:inherit}.bi-wrap{width:min(1180px,calc(100% - 36px));margin:auto}.bi-hero{position:relative;overflow:hidden;border-bottom:1px solid #2b3335;background:radial-gradient(circle at 80% 20%,#62431955,transparent 35%),linear-gradient(140deg,#171b1a,#090d0e 64%)}.bi-hero:before{content:"";position:absolute;inset:0;opacity:.09;background:repeating-linear-gradient(115deg,transparent 0 80px,#f8b331 81px,transparent 82px)}.bi-hero .bi-wrap{position:relative;padding:88px 0 78px}.eyebrow{font-size:11px;color:#ffca57;font-weight:900;letter-spacing:.2em}.bi-hero h1{font-size:clamp(57px,10vw,120px);line-height:.85;letter-spacing:-.07em;margin:22px 0 25px;font-weight:1000}.bi-hero h1 em{font-style:normal;color:#ffc44c}.bi-hero p{max-width:680px;font-size:18px;line-height:1.65;color:#b7c1c3}.bi-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}.bi-actions a,.bi-login a{display:inline-flex;padding:16px 23px;background:#f4b738;color:#10100b;font-size:12px;font-weight:950;letter-spacing:.06em;text-decoration:none;border-radius:7px}.bi-actions a.outline{background:transparent;border:1px solid #56605b;color:#f2f3ee}.bi-details{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:42px}.bi-detail{padding:20px;border:1px solid #3f4134;background:#141713c9;border-radius:9px}.bi-detail b{display:block;font-size:25px}.bi-detail small{display:block;color:#9da49a;margin-top:7px;text-transform:uppercase;font-size:10px;letter-spacing:.1em}.bi-content{padding:66px 0 80px}.bi-content h2{font-size:clamp(28px,4vw,43px);margin:8px 0 14px;letter-spacing:-.035em}.lead{font-size:16px;line-height:1.7;color:#b2bbbc;max-width:850px}.phases{display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin-top:27px}.phase{padding:28px;background:linear-gradient(160deg,#192022,#101516);border:1px solid #303c3d;border-radius:11px}.phase span{color:#ebb85b;font-size:11px;letter-spacing:.13em;font-weight:900}.phase strong{display:block;font-size:25px;margin:15px 0 8px}.phase p{color:#b1babb;font-size:14px;line-height:1.65}.phase i{font-style:normal;color:#ffc24a;font-weight:900}.bi-rules{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:55px}.rulesbox{padding:28px;background:#101516;border:1px solid #263032;border-radius:11px}.rulesbox h3{font-size:21px;margin:0 0 18px}.rulesbox li{margin:12px 0;color:#bbc4c4;line-height:1.55}.bi-registration{margin-top:65px;scroll-margin-top:100px;background:linear-gradient(140deg,#161c19,#101416);border:1px solid #a47834;border-radius:14px;padding:clamp(22px,4vw,43px);box-shadow:0 15px 65px #0004}.bi-form-heading{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.bi-form-heading p,.bi-login p{color:#b0b8b6;line-height:1.65;max-width:680px}.free{border:1px solid #467956;background:#173322;color:#a0f0b1;padding:11px 14px;font-size:13px;border-radius:6px}.bi-form{margin-top:20px}.bi-form label{display:block;font-size:12px;font-weight:800;color:#dde5e0}.bi-form input:not([type=checkbox]):not([type=radio]){display:block;width:100%;margin-top:9px;padding:15px;background:#090d0e;border:1px solid #384541;border-radius:7px;color:#fff;font-size:14px;outline:none}.bi-form input:focus{border-color:#eeb64c}.players{display:grid;grid-template-columns:repeat(3,1fr);gap:13px;margin:22px 0}.player{padding:19px;background:#0b1111;border:1px solid #313d3c;border-radius:8px}.player strong{display:block;margin-bottom:21px}.player strong span{color:#f1ba4f}.player label+label{margin-top:16px}.agreement{display:flex!important;align-items:flex-start;gap:12px;line-height:1.6;max-width:830px;margin:24px 0;color:#c2cbca!important}.agreement input{width:18px;height:18px;accent-color:#f3b737;flex:0 0 18px;margin-top:2px}.bi-form button,.adminTeams button{padding:17px 24px;background:#f0b63f;color:#14110c;border:0;border-radius:7px;font-weight:950;font-size:12px;cursor:pointer}.bi-form button:disabled{opacity:.55;cursor:default}.bi-msg{min-height:22px;font-size:14px}.bi-login a{margin:12px 0;max-width:100%}.bi-login small{display:block;color:#8f9e9d;margin-top:13px}.adminTeams{padding:24px;margin-top:45px;border:1px solid #34443f;border-radius:10px}.adminTeams p{padding:12px;border-bottom:1px solid #263432;overflow-wrap:anywhere;font-size:13px}.bi-footer{text-align:center;border-top:1px solid #26302c;padding:28px;color:#8d9899;font-size:12px}.bi-footer b{color:#f6bd4e}
.bi-choices{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 24px}.bi-choice{display:flex!important;gap:12px;align-items:flex-start;padding:18px;border:1px solid #414941;border-radius:9px;background:#0b1110;cursor:pointer}.bi-choice:has(input:checked){border-color:#f0b63f;background:#232416}.bi-choice input{margin:2px 0 0;accent-color:#f0b63f;flex:0 0 auto}.bi-choice strong{display:block;color:#f3c65b;font-size:14px}.bi-choice small{display:block;font-weight:400;color:#bac5c0;margin-top:7px;font-size:12px;line-height:1.5}.bi-mode-panel{border:0;min-width:0;padding:0;margin:0}.bi-mode-panel[hidden]{display:none!important}.bi-random-notice{line-height:1.7;background:#151c19;color:#c9d3cf;padding:17px;border:1px solid #35443d;border-radius:8px}.bi-solo-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:23px}.bi-signup-info{margin-top:55px}.bi-confirm-link{display:inline-block;margin-top:7px;color:#f7c65e;font-size:12px;font-weight:900}
.bi-count-line{display:inline-flex;align-items:center;gap:10px;margin:22px 0 0;padding:10px 16px;border:1px solid #6b5420;border-radius:999px;background:#17140b;color:#ffd478;font-weight:800;font-size:13px;letter-spacing:.02em}.bi-count-line:empty{display:none}.bi-count-line:not(:empty)::before{content:"";width:8px;height:8px;border-radius:50%;background:#4fe38a;box-shadow:0 0 12px #4fe38a}
@media(max-width:800px){.bi-choices,.bi-solo-fields{grid-template-columns:1fr}.bi-hero .bi-wrap{padding:60px 0}.bi-hero p{font-size:15px}.bi-details,.phases,.players,.bi-rules{grid-template-columns:1fr}.bi-details{gap:8px}.bi-detail{padding:16px}.bi-content{padding:40px 0}.bi-registration{margin-top:40px}.bi-form-heading{flex-direction:column}.bi-hero h1{font-size:clamp(56px,14vw,94px)}}
</style></head><body>
<header class="bi-hero"><div class="bi-wrap"><span class="eyebrow">GUERRA FRIA RUST • EVENTO ESPECIAL</span><h1>BASE<br><em>INVADERS.</em></h1><p>Construa sua fortaleza. Domine o PvP. Invada seus adversários. Em cinco horas de competição, apenas os melhores trios resistirão.</p><div class="bi-actions"><a href="#inscricao">INSCREVA-SE GRÁTIS ↗</a><a class="outline" href="#regras">CONHECER AS REGRAS</a></div><div class="bi-details"><div class="bi-detail"><b>SÁBADO</b><small>Data e horário a definir</small></div><div class="bi-detail"><b>5 HORAS</b><small>Duração do evento</small></div><div class="bi-detail"><b>TRIOS • GRÁTIS</b><small>3 jogadores por equipe</small></div></div><p class="bi-count-line" id="bi-count-line">Contando inscrições...</p></div></header>
<main class="bi-wrap bi-content"><section><span class="eyebrow">O DESAFIO</span><h2>Como funciona o Guerra Fria Invaders?</h2><p class="lead">No Guerra Fria Invaders, cada trio constrói sua própria base, disputa recursos e enfrenta outras equipes até a fase final de invasões. Seu TC (armário de ferramentas) é o coração da equipe: proteja o seu e tente destruir os dos adversários. A classificação considera a sobrevivência das equipes e a pontuação obtida ao longo da partida.</p></section>
<section id="fases" style="margin-top:45px"><span class="eyebrow">UMA PARTIDA • TRÊS FASES</span><h2>O cronograma de 5 horas</h2><div class="phases"><article class="phase"><span>FASE 01 • 90 MIN</span><strong>Build</strong><p>Hora de coletar recursos, escolher a localização e construir sua base. <i>Sem PvP e sem raids.</i></p></article><article class="phase"><span>FASE 02 • 90 MIN</span><strong>Attack</strong><p>O combate entre equipes começa. Dispute recursos, abates e objetivos. <i>PvP liberado, raids bloqueadas.</i></p></article><article class="phase"><span>FASE 03 • 120 MIN</span><strong>Raid</strong><p>Vale tudo dentro do regulamento: ataque bases inimigas e proteja seu TC. <i>PvP e raids liberadas.</i></p></article></div><p class="lead" style="font-size:13px;margin-top:15px">A distribuição de tempo acima é uma adaptação da Guerra Fria para cinco horas. Detalhes de pontuação, mapa, recursos e premiação serão anunciados pela organização antes do evento.</p></section>
<section class="bi-rules" id="regras"><div class="rulesbox"><h3>Como vencer?</h3><ul><li>Defenda seu TC: equipes com o armário destruído serão eliminadas.</li><li>Ganhe pontos em confrontos e objetivos do evento, conforme tabela divulgada antes da partida.</li><li>O último trio sobrevivente vence; havendo mais de um sobrevivente no fim, a pontuação define a liderança.</li></ul></div><div class="rulesbox"><h3>Regras principais</h3><ul><li>Equipes de três jogadores. Inscreva seu trio completo ou participe individualmente: o sorteio das equipes aleatórias será no dia do evento.</li><li>Proibido cheats, scripts, exploração de bugs ou alianças entre equipes.</li><li>Uma base principal por equipe, com TC acessível para invasões legítimas.</li><li>Respeite as fases e as decisões da administração. Regulamento completo antes do evento.</li><li><strong>Vagas:</strong> 33 equipes jogam. As inscrições são ilimitadas. No dia do evento, times já formados entram e ocupam vaga; jogadores solo entram no servidor por ordem de chegada e são sorteados em trios. Ao completar 33 equipes, o servidor trava e os demais são desconectados até o fim do evento.</li></ul></div></section>
<section class="bi-signup-info"><span class="eyebrow">DUAS FORMAS DE PARTICIPAR</span><h2>Trio fechado ou sorteio de equipes</h2><p class="lead"><strong>Trio fechado:</strong> faça a inscrição de três jogadores juntos, com nome de equipe. <strong>Inscrição aleatória:</strong> não tem time? Cadastre apenas seus dados e, no dia do evento, a organização sorteará e montará trios entre os participantes dessa modalidade. As duas opções são gratuitas.</p></section><section class="bi-registration" id="inscricao"><!--REGISTRATION_FORM--></section><!--ADMIN_SECTION-->
</main><footer class="bi-footer">GUERRA FRIA RUST • <b>GUERRA FRIA INVADERS</b> • EVENTO DA COMUNIDADE</footer>
<script>(()=>{const el=document.getElementById('bi-count-line');if(!el)return;fetch('/api/base-invaders/contagem',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{if(!d){el.textContent='';return;}const eq=d.trioTeams,so=d.soloPlayers;if(typeof eq!=="number"||typeof so!=="number"){el.textContent="";return;}el.textContent=eq+(eq===1?' equipe em trio inscrita':' equipes em trio inscritas')+' • '+so+(so===1?' jogador solo inscrito':' jogadores solo inscritos');}).catch(()=>{el.textContent='';});})();</script></body></html>`;
  return html
    .replace("<!--REGISTRATION_FORM-->", session ? registrationForm : loginForm)
    .replace("<!--ADMIN_SECTION-->", session?.isAdmin ? adminSection : "");
}
