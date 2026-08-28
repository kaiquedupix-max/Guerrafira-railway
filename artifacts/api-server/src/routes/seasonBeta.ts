import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getCommunitySession } from "../admin/communitySession.js";
import { executeRconCommand } from "../bot/utils/rcon.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const BETA_START = Date.parse("2026-08-28T18:30:00-03:00");
const OFFICIAL_START = Date.parse("2026-09-04T18:30:00-03:00");
const BETA_KEY = "season-beta-2026-08-28";
const BETA_ROLE_ID = "1542955942516359289";
let controllerStarted = false;

const br = (ms: number) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long", timeStyle: "short" }).format(new Date(ms));

async function ensureTables() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_beta_control (control_key TEXT PRIMARY KEY, completed_at TIMESTAMPTZ NOT NULL DEFAULT now(), details TEXT)`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS season_registrations (
      season_number INTEGER NOT NULL,
      discord_id TEXT NOT NULL,
      discord_name TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'beta_free',
      status TEXT NOT NULL DEFAULT 'active',
      accepted_rules_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (season_number, discord_id)
    )
  `);
}

async function alreadyStarted() {
  await ensureTables();
  const r: any = await db.execute(sql`SELECT control_key FROM season_beta_control WHERE control_key=${BETA_KEY} LIMIT 1`);
  return Boolean(r?.rows?.[0]);
}

async function startBetaOnce() {
  if (await alreadyStarted()) return true;
  logger.info("[SEASON BETA] iniciando reset coordenado da Season");
  const reply = await executeRconCommand("season.forcenew beta-2026-08-28");
  if (reply == null) {
    logger.error("[SEASON BETA] RCON não confirmou season.forcenew; reset será tentado novamente");
    return false;
  }
  await ensureTables();
  await db.transaction(async tx => {
    await tx.execute(sql`DELETE FROM season_transactions WHERE season_number=1`);
    await tx.execute(sql`DELETE FROM season_players WHERE season_number=1`);
    await tx.execute(sql`DELETE FROM seasons WHERE season_number=1`);
    await tx.execute(sql`DELETE FROM season_registrations WHERE season_number=1`);
    await tx.execute(sql`INSERT INTO season_beta_control (control_key, details) VALUES (${BETA_KEY}, ${"Plugin resetado via season.forcenew beta-2026-08-28 e dados da Season 1 zerados."}) ON CONFLICT DO NOTHING`);
  });
  logger.info({ reply }, "[SEASON BETA] reset concluído; coleta liberada");
  return true;
}

async function tryStartWithRetry() {
  try {
    const ok = await startBetaOnce();
    if (!ok) setTimeout(() => void tryStartWithRetry(), 60_000);
  } catch (error) {
    logger.error({ error }, "[SEASON BETA] falha no reset; nova tentativa em 60s");
    setTimeout(() => void tryStartWithRetry(), 60_000);
  }
}

export function startSeasonBetaController() {
  if (controllerStarted) return;
  controllerStarted = true;
  const delay = BETA_START - Date.now();
  if (delay <= 0) void tryStartWithRetry();
  else {
    logger.info({ startsAt: br(BETA_START), delayMs: delay }, "[SEASON BETA] reset agendado");
    setTimeout(() => void tryStartWithRetry(), delay);
  }
}

router.use(async (req, res, next) => {
  if ((req.path === "/season/events" || req.path === "/season/snapshot") && Date.now() < BETA_START) {
    res.setHeader("Cache-Control", "no-store");
    return void res.status(202).json({ ok: true, beta: true, accepted: 0, message: `Season Beta ainda não iniciou. Coleta liberada em ${br(BETA_START)}.` });
  }
  next();
});

async function assignBetaRole(discordId: string) {
  const guildId = String(process.env.DISCORD_GUILD_ID || "").trim();
  const roleId = String(process.env.SEASON_BETA_ROLE_ID || BETA_ROLE_ID).trim();
  const token = String(process.env.DISCORD_BOT_TOKEN || "").trim();
  if (!guildId || !roleId || !token) return { ok: false, reason: "Configuração do Discord incompleta" };
  const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${roleId}`, {
    method: "PUT",
    headers: { Authorization: `Bot ${token}` },
  });
  if (!r.ok) return { ok: false, reason: `Discord HTTP ${r.status}` };
  return { ok: true, reason: "" };
}

router.get("/season/:number/inscricao/status", async (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return void res.status(401).json({ ok: false, authenticated: false });
  await ensureTables();
  const season = Math.max(1, Math.trunc(Number(req.params.number) || 1));
  const r: any = await db.execute(sql`SELECT mode,status,accepted_rules_at,created_at FROM season_registrations WHERE season_number=${season} AND discord_id=${session.userId} LIMIT 1`);
  return void res.json({ ok: true, authenticated: true, registered: Boolean(r?.rows?.[0]), registration: r?.rows?.[0] || null, user: { id: session.userId, username: session.username } });
});

router.post("/season/:number/inscricao", async (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return void res.status(401).json({ ok: false, error: "Faça login com Discord antes de se inscrever." });
  const season = Math.max(1, Math.trunc(Number(req.params.number) || 1));
  if (season !== 1) return void res.status(400).json({ ok: false, error: "Inscrição Beta disponível apenas para a Season 1 de testes." });
  if (Date.now() >= OFFICIAL_START) return void res.status(409).json({ ok: false, error: "A fase Beta foi encerrada. A Season oficial exige uma nova inscrição." });
  if (req.body?.accept !== true) return void res.status(400).json({ ok: false, error: "É necessário aceitar o regulamento e reconhecer que esta é uma Season de teste." });
  try {
    await ensureTables();
    const role = await assignBetaRole(session.userId);
    if (!role.ok) return void res.status(503).json({ ok: false, error: `Não foi possível aplicar o cargo Season Tester: ${role.reason}.` });
    await db.execute(sql`
      INSERT INTO season_registrations (season_number,discord_id,discord_name,mode,status,accepted_rules_at,updated_at)
      VALUES (${season},${session.userId},${session.username},'beta_free','active',now(),now())
      ON CONFLICT (season_number,discord_id) DO UPDATE SET discord_name=EXCLUDED.discord_name,status='active',accepted_rules_at=now(),updated_at=now()
    `);
    return void res.json({ ok: true, registered: true, role_applied: true, role_id: String(process.env.SEASON_BETA_ROLE_ID || BETA_ROLE_ID), message: "Inscrição Beta concluída. O cargo Season Tester foi aplicado automaticamente no Discord." });
  } catch (error) {
    logger.error({ error }, "season beta registration failed");
    return void res.status(500).json({ ok: false, error: "Falha ao concluir a inscrição Beta." });
  }
});

function pageShell(title: string, body: string) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#08090b"><title>${title}</title><style>
:root{--bg:#07080a;--p:#101216;--p2:#15181e;--line:#2b3039;--txt:#f7f7f5;--mut:#a0a7b2;--red:#ef4444;--red2:#7f1d1d;--gold:#f59e0b;--green:#22c55e}*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;background:radial-gradient(circle at 50% -10%,#46160f,#171012 28%,#08090b 62%);color:var(--txt);font-family:Inter,system-ui,-apple-system,sans-serif;min-height:100vh}.wrap{width:min(1040px,calc(100% - 24px));margin:auto;padding:24px 0 70px}.hero{padding:35px 0 20px}.ey{font-size:10px;font-weight:1000;letter-spacing:.2em;color:#fca5a5;text-transform:uppercase}.hero h1{font-size:clamp(38px,8vw,72px);letter-spacing:-.05em;line-height:.95;margin:8px 0 12px}.hero p{color:var(--mut);line-height:1.65;max-width:820px}.beta{border:1px solid #ef444477;background:linear-gradient(135deg,#351012,#180d10);border-radius:18px;padding:18px;margin:12px 0 18px;box-shadow:0 18px 50px #0005}.beta b{color:#fca5a5}.beta div{margin-top:6px;color:#e5c5c7;line-height:1.55;font-size:13px}.back,.btn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;border-radius:11px;padding:12px 15px;font-weight:950;font-size:12px}.back{border:1px solid var(--line);color:#fff;background:#11141a}.btn{border:1px solid #ef4444;background:linear-gradient(135deg,#ef4444,#b91c1c);color:white;cursor:pointer;box-shadow:0 10px 26px #ef444422}.btn.secondary{background:#15181e;border-color:#414754}.btn[disabled]{opacity:.5}.card{background:linear-gradient(180deg,#111419,#0c0e12);border:1px solid var(--line);border-radius:18px;padding:19px;margin:12px 0;box-shadow:0 16px 45px #0003}.card h2{margin:0 0 10px;font-size:19px}.card h3{margin:18px 0 7px;font-size:14px}.card p,.card li{color:#c6cbd3;line-height:1.68;font-size:13px}.card strong{color:#fff}.rule{position:relative;padding-left:76px}.ruleNo{position:absolute;left:18px;top:18px;width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:#2a1113;border:1px solid #733033;color:#fca5a5;font-weight:1000}.dates,.visualGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.date,.visual{border:1px solid var(--line);border-radius:14px;padding:15px;background:#11141a}.date b,.visual b{display:block}.date span,.visual span{display:block;font-size:11px;color:var(--mut);margin-top:4px;line-height:1.5}.flow{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:center;gap:8px;margin:16px 0}.node{border:1px solid #3b414c;background:#11141a;border-radius:14px;padding:14px;text-align:center;min-height:92px;display:grid;place-items:center}.node b{font-size:12px}.node small{color:var(--mut);font-size:10px}.arrow{color:#f87171;font-weight:1000}.prizes{display:grid;grid-template-columns:1fr 1fr;gap:10px}.prize{border:1px solid #4b3928;background:linear-gradient(160deg,#19140d,#0d0f13);border-radius:15px;padding:15px}.prize h3{margin:0 0 10px;color:#fde68a}.prize div{font-size:12px;line-height:1.9;color:#d6d3d1}.check{display:flex;gap:10px;align-items:flex-start;margin:16px 0;color:#d5d9df;font-size:13px;line-height:1.5}.msg{margin-top:12px;color:#fca5a5;font-size:12px}.ok{color:#86efac}.stage{display:none}.stage.show{display:block}.warningList{display:grid;gap:9px;margin:15px 0}.warningItem{display:flex;gap:10px;padding:12px;border:1px solid #3b3032;background:#151013;border-radius:12px}.warningItem span:first-child{font-size:21px}.warningItem b{display:block;font-size:12px}.warningItem small{color:#a7aab1;line-height:1.5}.stickyAction{position:sticky;bottom:10px;z-index:5;background:#0b0d11e8;backdrop-filter:blur(12px);border:1px solid #3a3e46;border-radius:15px;padding:10px;display:flex;gap:9px;margin-top:18px}.stickyAction .btn{flex:1}.toc{display:flex;gap:7px;overflow:auto;padding:3px 0 12px}.toc a{white-space:nowrap;text-decoration:none;color:#c8cbd1;background:#11141a;border:1px solid var(--line);border-radius:999px;padding:7px 10px;font-size:10px;font-weight:850}@media(max-width:680px){.dates,.visualGrid,.prizes{grid-template-columns:1fr}.flow{grid-template-columns:1fr}.arrow{transform:rotate(90deg);text-align:center}.rule{padding-left:18px;padding-top:72px}.ruleNo{top:16px}.wrap{padding-top:14px}.stickyAction{flex-direction:column}.hero{padding-top:24px}}
</style></head><body><main class="wrap">${body}</main></body></html>`;
}

router.get("/season/:number/inscricao", async (req, res) => {
  const season = Math.max(1, Math.trunc(Number(req.params.number) || 1));
  const session = getCommunitySession(req);
  if (!session) return void res.redirect("/api/admin/auth/login?target=season");
  await ensureTables();
  const current: any = await db.execute(sql`SELECT status,created_at FROM season_registrations WHERE season_number=${season} AND discord_id=${session.userId} LIMIT 1`);
  const registered = Boolean(current?.rows?.[0]);
  const safeName = session.username.replace(/[<>&"']/g, "");
  const body = `<a class="back" href="/season${season}">← Voltar para Season</a><section class="hero"><div class="ey">🧪 BETA SEASON TESTER • GUERRA FRIA</div><h1>Inscrição de Testador</h1><p>Olá, <strong>${safeName}</strong>. Antes de continuar, leia com atenção: esta inscrição é para testar e balancear o sistema que será usado na Season oficial.</p></section>${registered ? `<div class="beta"><b>✅ VOCÊ JÁ É SEASON TESTER</b><div>Sua inscrição está registrada e o cargo de testador foi aplicado no Discord. Continue jogando normalmente para ajudar a administração a validar pontuação, patentes, eventos e balanceamento.</div></div><div class="dates"><div class="date"><b>🧪 Beta em andamento</b><span>28/08/2026 • 18:30 até 04/09/2026 • 18:30</span></div><div class="date"><b>🏆 Season oficial</b><span>04/09/2026 • após o wipe das 18:30</span></div></div>` : `<section id="intro" class="stage show"><div class="beta"><b>⚠️ ESTA SEASON NÃO TEM PREMIAÇÃO</b><div>O período Beta existe exclusivamente para testes. Ranking, MMR, pesos, patentes e critérios podem ser ajustados, recalculados ou zerados pela administração durante esta fase.</div></div><div class="warningList"><div class="warningItem"><span>🧪</span><div><b>É um ambiente de teste</b><small>Seus dados ajudam a encontrar bugs e definir o balanceamento final.</small></div></div><div class="warningItem"><span>🏆</span><div><b>Não vale premiação</b><small>Não há dinheiro, VIP ou qualquer prêmio oficial vinculado ao resultado desta Beta.</small></div></div><div class="warningItem"><span>⚙️</span><div><b>Pontuação pode mudar</b><small>A equipe poderá alterar pesos, fórmulas, limites e patentes sempre que necessário.</small></div></div><div class="warningItem"><span>📅</span><div><b>A Season real começa em 04/09/2026</b><small>A primeira Season oficial inicia na sexta-feira, 04 de setembro, após o wipe das 18:30.</small></div></div><div class="warningItem"><span>🎖️</span><div><b>Você recebe o cargo Season Tester</b><small>Ao concluir a inscrição, o cargo será aplicado automaticamente no seu Discord.</small></div></div></div><button class="btn" id="continue">CONTINUAR COM A INSCRIÇÃO →</button></section><section id="confirm" class="stage"><div class="dates"><div class="date"><b>🧪 Beta</b><span>28/08/2026 • 18:30 até 04/09/2026 • 18:30</span></div><div class="date"><b>🏆 Season oficial</b><span>04/09/2026 • após o wipe das 18:30</span></div></div><section class="card"><h2>Confirmar participação no Beta</h2><p>Ao concluir, você confirma que entendeu que esta fase é <strong>somente de testes e sem premiação</strong>. Seu Discord será registrado como participante e receberá automaticamente o cargo <strong>Season Tester</strong>.</p><label class="check"><input id="accept" type="checkbox"> <span>Li o <a href="/api/season/${season}/regras" style="color:#fca5a5">Regulamento da Season</a> e reconheço que os resultados desta Beta podem ser ajustados ou zerados antes da Season oficial.</span></label><div class="stickyAction"><button class="btn secondary" id="backStage">← VOLTAR</button><button class="btn" id="send">CONFIRMAR INSCRIÇÃO</button></div><div class="msg" id="msg"></div></section></section><script>var intro=document.getElementById('intro'),confirmBox=document.getElementById('confirm');document.getElementById('continue').onclick=function(){intro.classList.remove('show');confirmBox.classList.add('show');window.scrollTo({top:0,behavior:'smooth'})};document.getElementById('backStage').onclick=function(){confirmBox.classList.remove('show');intro.classList.add('show')};document.getElementById('send').onclick=async function(){var b=this,m=document.getElementById('msg'),a=document.getElementById('accept');if(!a.checked){m.textContent='Você precisa aceitar o regulamento e reconhecer que esta fase é um teste.';return}b.disabled=true;m.textContent='Registrando inscrição e aplicando o cargo Season Tester no Discord...';try{var r=await fetch('/api/season/${season}/inscricao',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accept:true})});var j=await r.json();if(!r.ok)throw new Error(j.error||'Falha');m.className='msg ok';m.textContent=j.message;setTimeout(()=>location.reload(),900)}catch(e){m.className='msg';m.textContent=e.message;b.disabled=false}}</script>`}`;
  res.setHeader("Cache-Control", "no-store");
  return void res.status(200).type("html").send(pageShell("Inscrição Season Beta • Guerra Fria", body));
});

router.get("/season/:number/regras", (req, res) => {
  const season = Math.max(1, Math.trunc(Number(req.params.number) || 1));
  const rule = (n: number, icon: string, title: string, content: string) => `<section class="card rule" id="r${n}"><div class="ruleNo">${n}</div><h2>${icon} ${title}</h2>${content}</section>`;
  const sections = `
<div class="beta"><b>⚠️ REGULAMENTO EM CONSTRUÇÃO • SEASON BETA / TESTE</b><div>De 28/08/2026 às 18:30 até 04/09/2026 às 18:30, o sistema está em fase de testes. <strong>Não existe premiação nesta Beta.</strong> Pontuação, patentes, pesos e regras técnicas podem ser ajustados para preparar a Season oficial.</div></div>
<div class="flow"><div class="node"><div>🧪</div><b>BETA</b><small>testar e medir</small></div><div class="arrow">→</div><div class="node"><div>⚙️</div><b>BALANCEAMENTO</b><small>corrigir pesos e patentes</small></div><div class="arrow">→</div><div class="node"><div>🏆</div><b>SEASON OFICIAL</b><small>04/09/2026 • 18:30</small></div></div>
${rule(1,"📅","Sobre a Season",`<p>A Season Guerra Fria será realizada em ciclos mensais, acompanhando o ciclo de Wipe do servidor.</p><ul><li>A Season começa <strong>sempre na primeira sexta-feira de cada mês</strong>, após o Force Wipe.</li><li>O último dia será sempre o último dia do mês.</li><li>Ao final será definido o ranking dos jogadores participantes.</li><li>Resultados, vencedores e premiações serão apresentados em uma <strong>live especial do Guerra Fria</strong>.</li></ul>`)}
${rule(2,"🎯","Sistema de pontuação",`<p>A pontuação será acumulada desde o início da Season, independentemente da modalidade escolhida. O sistema poderá contabilizar raids, PvP, farm, coleta, bots, NPCs, animais, fauna, Chinook, Cargo, Cargo Royale, Oil Rig, eventos atuais ou futuros, loot, progressão, mortes e outras ações monitoradas.</p><div class="visualGrid"><div class="visual"><b>⚔️ Combate e Raid</b><span>PvP, raids, defesa, explosivos e ações relacionadas.</span></div><div class="visual"><b>⛏️ Progressão</b><span>Farm, coleta, loot, construção e evolução.</span></div><div class="visual"><b>🗺️ Eventos</b><span>Cargo, Chinook, Oil Rig, Bradley e demais eventos.</span></div><div class="visual"><b>🤖 Mundo</b><span>NPCs, bots, animais e outras interações válidas.</span></div></div><p>A intenção é não premiar somente um estilo de jogador. A lista é exemplificativa e novas ações poderão ser incluídas. Critérios, pesos e valores serão definidos e divulgados pela administração.</p>`)}
${rule(3,"👥","Limite de jogadores",`<p>O Guerra Fria terá limite máximo de <strong>200 jogadores simultâneos</strong>. Com os 200 espaços ocupados, os demais aguardam na fila. Todos os VIPs possuem prioridade na fila. A inscrição na Season não garante vaga exclusiva.</p>`)}
${rule(4,"📝","Inscrição e formas de participação",`<p>Para participar oficialmente e ter direito às premiações, todo jogador deverá realizar inscrição, seja gratuita ou paga.</p><div class="prizes"><div class="prize"><h3>🆓 Inscrição gratuita</h3><div>🥇 VIP Ouro<br>🥈 VIP Prata<br>🥉 VIP Bronze</div></div><div class="prize"><h3>💰 Inscrição paga • R$20</h3><div>🥇 50% do acumulado<br>🥈 30% do acumulado<br>🥉 VIP Ouro por 30 dias</div></div></div><h3>⏰ Prazo</h3><p>As inscrições poderão ser realizadas até o <strong>dia 20 de cada mês</strong>. Depois do prazo não será possível realizar nova inscrição. Quem não estiver inscrito não será participante oficial e não terá direito a premiação, mesmo que possua a maior pontuação.</p><p><strong>Importante:</strong> a inscrição desta Beta é gratuita, serve somente para testes e não gera direito a premiação.</p>`)}
${rule(5,"🏆","Premiação",`<div class="prizes"><div class="prize"><h3>Pagantes</h3><div>🥇 50% do valor acumulado<br>🥈 30% do valor acumulado<br>🥉 VIP Ouro por 30 dias</div></div><div class="prize"><h3>Gratuitos</h3><div>🥇 VIP Ouro<br>🥈 VIP Prata<br>🥉 VIP Bronze</div></div></div><p>O jogador gratuito não poderá receber a parcela em dinheiro destinada ao primeiro ou segundo colocado. O valor correspondente permanecerá no saldo acumulado para as próximas Seasons.</p>`)}
${rule(6,"💰","Garantia mínima de R$300",`<p>A Season oficial terá premiação mínima garantida de <strong>R$300,00</strong>. Enquanto o valor disponível não atingir R$300, o Guerra Fria completará a diferença. As inscrições pagas de R$20 formarão o valor acumulado.</p><div class="flow"><div class="node"><b>10 inscritos</b><small>R$200 + R$100 GF</small></div><div class="arrow">→</div><div class="node"><b>15 inscritos</b><small>R$300 garantidos</small></div><div class="arrow">→</div><div class="node"><b>20 inscritos</b><small>R$400 acumulados</small></div></div><p>O valor somente cresce acima dos R$300 quando o total disponível ultrapassa essa garantia mínima.</p>`)}
${rule(7,"🔄","Saldo acumulado e valores não retirados",`<p>Dinheiro destinado a uma premiação que não for retirado por um jogador gratuito não será perdido e não será transferido para outro jogador. Ele permanecerá acumulado para as próximas Seasons.</p><p>Se após o encerramento o saldo ficar abaixo de R$300, o Guerra Fria completará a diferença para a próxima Season. Se estiver acima de R$300, todo o valor permanecerá acumulado.</p>`)}
${rule(8,"🏰","Cota do Guerra Fria",`<p><strong>20% do valor acumulado</strong> será destinado ao Guerra Fria para manutenção, infraestrutura, suporte e custos do servidor. Essa porcentagem não representa posição no ranking, não é premiação do terceiro colocado e não interfere nos prêmios VIP.</p><p>Terceiro colocado pagante: VIP Ouro por 30 dias. Terceiro colocado gratuito: VIP Bronze.</p>`)}
${rule(9,"✅","Aceitação dos termos",`<p>Ao clicar em <strong>“Inscrever-se”</strong>, o jogador declara estar ciente de sua participação e das regras. Na inscrição paga, a confirmação do pagamento de R$20 representa aceitação integral do regulamento, sistema de pontuação, premiações, desclassificação, regras do servidor e demais condições.</p>`)}
${rule(10,"🚫","Cancelamento e reembolso",`<p>Após a confirmação do pagamento de R$20 na Season oficial, o jogador não poderá desistir solicitando devolução do valor pago. O pagamento representa aceitação dos termos. <strong>A Beta atual não possui cobrança.</strong></p>`)}
${rule(11,"🛑","Burla ou manipulação do sistema",`<p>Qualquer tentativa de burlar, manipular, explorar ou obter vantagem indevida poderá resultar em <strong>desclassificação imediata</strong>. Isso inclui manipulação de pontuação ou ranking, exploração de bugs ou falhas, fraude na inscrição, manipulação de eventos e qualquer vantagem irregular.</p>`)}
${rule(12,"🎮","Uso de cheats",`<p>O uso de qualquer cheat ou software de trapaça será motivo para desclassificação da Season. A regra não se limita ao Rust: caso seja comprovado que o jogador utiliza cheats em qualquer outro jogo no computador, ele também poderá ser desclassificado. O objetivo é preservar a integridade e a credibilidade da competição.</p>`)}
${rule(13,"⚠️","Problemas técnicos e situações excepcionais",`<p>Mesmo com infraestrutura dedicada e suporte especializado, podem ocorrer ataques, quedas, lag, instabilidades, bugs do Rust, falhas técnicas ou problemas externos. Essas situações <strong>não implicam automaticamente</strong> alteração do calendário, duração, pontuação, premiação, ranking, regras ou período de participação.</p>`)}
${rule(14,"🔧","Sistema em construção",`<p>O sistema de Seasons ainda está em desenvolvimento. Poderão ocorrer bugs, erros, falhas de contabilização, ajustes técnicos, correções, alterações na pontuação e melhorias. A administração poderá realizar os ajustes necessários. As regras definitivas e os critérios completos serão divulgados antes da Season oficial.</p>`)}
${rule(15,"🎥","Encerramento e divulgação dos resultados",`<p>Ao término da Season oficial será feito o fechamento do ranking. Os vencedores serão anunciados nos canais oficiais e em uma <strong>live especial de encerramento</strong>, com ranking final, pontuação e premiações.</p><div class="prizes"><div class="prize"><h3>Pagantes</h3><div>🥇 50% • 🥈 30% • 🥉 VIP Ouro 30 dias</div></div><div class="prize"><h3>Gratuitos</h3><div>🥇 VIP Ouro • 🥈 VIP Prata • 🥉 VIP Bronze</div></div></div><p><strong>Guerra Fria:</strong> 20% do valor acumulado, conforme a cláusula financeira de manutenção e operação.</p>`)}
`;
  const toc = `<div class="toc">${Array.from({length:15},(_,i)=>`<a href="#r${i+1}">${i+1}</a>`).join("")}</div>`;
  const body = `<a class="back" href="/season${season}">← Voltar para Season</a><section class="hero"><div class="ey">📜 REGULAMENTO • GUERRA FRIA</div><h1>Regras da Season</h1><p>Regulamento completo da Season Guerra Fria. A versão atual está em construção e a fase exibida agora é <strong>Beta/Teste, sem premiação</strong>.</p></section>${toc}${sections}<div class="stickyAction"><a class="btn secondary" href="/season${season}">VOLTAR À SEASON</a><a class="btn" href="/api/season/${season}/inscricao">QUERO SER SEASON TESTER</a></div>`;
  res.setHeader("Cache-Control", "no-store");
  return void res.status(200).type("html").send(pageShell("Regulamento Season • Guerra Fria", body));
});

export default router;
