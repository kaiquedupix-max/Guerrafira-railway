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
  const roleId = String(process.env.SEASON_BETA_ROLE_ID || "").trim();
  const token = String(process.env.DISCORD_BOT_TOKEN || "").trim();
  if (!guildId || !roleId || !token) return { ok: false, reason: "SEASON_BETA_ROLE_ID não configurado" };
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
    if (!role.ok) return void res.status(503).json({ ok: false, error: `Não foi possível aplicar o cargo Beta Season Tester: ${role.reason}.` });
    await db.execute(sql`
      INSERT INTO season_registrations (season_number,discord_id,discord_name,mode,status,accepted_rules_at,updated_at)
      VALUES (${season},${session.userId},${session.username},'beta_free','active',now(),now())
      ON CONFLICT (season_number,discord_id) DO UPDATE SET discord_name=EXCLUDED.discord_name,status='active',accepted_rules_at=now(),updated_at=now()
    `);
    return void res.json({ ok: true, registered: true, role_applied: true, message: "Inscrição Beta concluída. Cargo Beta Season Tester aplicado no Discord." });
  } catch (error) {
    logger.error({ error }, "season beta registration failed");
    return void res.status(500).json({ ok: false, error: "Falha ao concluir a inscrição Beta." });
  }
});

function pageShell(title: string, body: string) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#08090b"><title>${title}</title><style>:root{--bg:#08090b;--p:#101216;--line:#2b3039;--txt:#f5f5f4;--mut:#a0a7b2;--red:#ef4444;--gold:#f59e0b}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% -10%,#3a140f,#130d10 28%,#08090b 62%);color:var(--txt);font-family:Inter,system-ui,-apple-system,sans-serif}.wrap{width:min(980px,calc(100% - 24px));margin:auto;padding:28px 0 60px}.beta{border:1px solid #ef444466;background:#311012;border-radius:16px;padding:16px;margin-bottom:18px}.beta b{color:#fca5a5}.hero{padding:32px 0 18px}.ey{font-size:10px;font-weight:950;letter-spacing:.18em;color:#fca5a5}.hero h1{font-size:clamp(38px,8vw,68px);margin:7px 0}.hero p{color:var(--mut);line-height:1.6}.card{background:#0d0f13;border:1px solid var(--line);border-radius:17px;padding:18px;margin:12px 0}.card h2{margin:0 0 10px;font-size:18px}.card h3{margin:18px 0 7px;font-size:14px}.card p,.card li{color:#c2c7d0;line-height:1.65;font-size:13px}.card strong{color:#fff}.back,.btn{display:inline-flex;text-decoration:none;border-radius:11px;padding:11px 14px;font-weight:950;font-size:12px}.back{border:1px solid var(--line);color:#fff;background:#11141a}.btn{border:0;background:#ef4444;color:white;cursor:pointer}.btn[disabled]{opacity:.5}.check{display:flex;gap:10px;align-items:flex-start;margin:16px 0;color:#d5d9df;font-size:13px;line-height:1.5}.msg{margin-top:12px;color:#fca5a5;font-size:12px}.ok{color:#86efac}.dates{display:grid;grid-template-columns:1fr 1fr;gap:10px}.date{border:1px solid var(--line);border-radius:13px;padding:13px;background:#11141a}.date b{display:block}.date span{font-size:11px;color:var(--mut)}@media(max-width:650px){.dates{grid-template-columns:1fr}.wrap{padding-top:15px}}</style></head><body><main class="wrap">${body}</main></body></html>`;
}

router.get("/season/:number/inscricao", async (req, res) => {
  const season = Math.max(1, Math.trunc(Number(req.params.number) || 1));
  const session = getCommunitySession(req);
  if (!session) return void res.redirect("/api/admin/auth/login?target=season");
  await ensureTables();
  const current: any = await db.execute(sql`SELECT status,created_at FROM season_registrations WHERE season_number=${season} AND discord_id=${session.userId} LIMIT 1`);
  const registered = Boolean(current?.rows?.[0]);
  const body = `<a class="back" href="/season${season}">← Voltar para Season</a><section class="hero"><div class="ey">BETA SEASON TESTER • GUERRA FRIA</div><h1>Inscrição da Season Beta</h1><p>Olá, <strong>${session.username.replace(/[<>&]/g, "")}</strong>. Esta inscrição é exclusivamente para a fase de testes e não gera cobrança nem direito à premiação da Season oficial.</p></section><div class="beta"><b>⚠️ SEASON DE TESTE</b><div>O Beta começa em <strong>28/08/2026 às 18:30</strong>. A Season oficial começa em <strong>04/09/2026 às 18:30</strong>. Todos os resultados Beta podem ser zerados, recalculados ou ajustados durante o balanceamento.</div></div><div class="dates"><div class="date"><b>🧪 Beta</b><span>28/08/2026 • 18:30 até 04/09/2026</span></div><div class="date"><b>🏆 Season oficial</b><span>04/09/2026 • após o wipe das 18:30</span></div></div><section class="card"><h2>${registered ? "✅ Você já está inscrito no Beta" : "Confirmar participação"}</h2><p>Ao se inscrever você aceita o regulamento em construção, reconhece que os dados desta fase servem apenas para testes e autoriza a aplicação automática do cargo <strong>Beta Season Tester</strong> no Discord.</p>${registered ? `<p class="ok">Sua inscrição já está registrada.</p>` : `<label class="check"><input id="accept" type="checkbox"> <span>Li o <a href="/api/season/${season}/regras" style="color:#fca5a5">regulamento</a> e entendo que esta Season é somente um teste, sem premiação oficial.</span></label><button class="btn" id="send">INSCREVER-SE NO BETA</button><div class="msg" id="msg"></div>`}</section>${registered ? "" : `<script>document.getElementById('send').onclick=async function(){var b=this,m=document.getElementById('msg'),a=document.getElementById('accept');if(!a.checked){m.textContent='Você precisa aceitar o regulamento.';return}b.disabled=true;m.textContent='Concluindo inscrição e aplicando cargo no Discord...';try{var r=await fetch('/api/season/${season}/inscricao',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accept:true})});var j=await r.json();if(!r.ok)throw new Error(j.error||'Falha');m.className='msg ok';m.textContent=j.message;setTimeout(()=>location.reload(),900)}catch(e){m.className='msg';m.textContent=e.message;b.disabled=false}}</script>`}`;
  res.setHeader("Cache-Control", "no-store");
  return void res.status(200).type("html").send(pageShell("Inscrição Season Beta • Guerra Fria", body));
});

router.get("/season/:number/regras", (req, res) => {
  const season = Math.max(1, Math.trunc(Number(req.params.number) || 1));
  const sections = `
<div class="beta"><b>⚠️ REGULAMENTO EM CONSTRUÇÃO • SEASON BETA</b><div>Este regulamento apresenta a estrutura atual. A fase iniciada em 28/08/2026 é exclusivamente de testes, balanceamento, definição de patentes e validação técnica. A Season oficial começa na primeira sexta-feira de setembro: <strong>04/09/2026, após o wipe das 18:30</strong>. Durante o Beta não há cobrança nem premiação oficial.</div></div>
<section class="card"><h2>1. 📅 Sobre a Season</h2><p>A Season Guerra Fria será realizada em ciclos mensais, acompanhando o ciclo de Wipe do servidor. A Season oficial começa sempre na primeira sexta-feira de cada mês, após o Force Wipe, e termina no último dia do mês. O ranking final, vencedores e premiações serão apresentados em live especial do Guerra Fria.</p></section>
<section class="card"><h2>2. 🎯 Sistema de pontuação</h2><p>A pontuação é acumulada desde o início da Season e considera a atividade geral do jogador, independentemente da modalidade de inscrição.</p><ul><li>Raids e PvP;</li><li>Farm e coleta de recursos;</li><li>Bots, NPCs, animais e fauna;</li><li>Todos os eventos e atividades do mapa, incluindo Chinook, Cargo, Cargo Royale, Oil Rig e eventos atuais ou futuros;</li><li>Loot e progressão;</li><li>Mortes e outras mecânicas monitoradas;</li><li>Outras atividades que possam ser contabilizadas pela plataforma.</li></ul><p>A lista é exemplificativa. Critérios, pesos e valores poderão ser ajustados e serão divulgados pela administração antes da Season oficial.</p></section>
<section class="card"><h2>3. 👥 Limite de jogadores</h2><p>O servidor terá limite máximo de <strong>200 jogadores simultâneos</strong>. Com os espaços ocupados, haverá fila. VIPs possuem prioridade na fila. A inscrição na Season não garante vaga exclusiva.</p></section>
<section class="card"><h2>4. 📝 Inscrição e formas de participação</h2><p>Para participar oficialmente e ter direito a premiações, a inscrição é obrigatória.</p><h3>🆓 Gratuita</h3><p>Disputa normalmente o ranking. Premiação: 🥇 VIP Ouro; 🥈 VIP Prata; 🥉 VIP Bronze.</p><h3>💰 Paga — R$20,00</h3><p>Somente inscrições pagas e confirmadas concorrem às parcelas em dinheiro. Premiação: 🥇 50% do valor acumulado; 🥈 30%; 🥉 VIP Ouro por 30 dias.</p><h3>⏰ Prazo</h3><p>Inscrições até o dia 20 de cada mês. Depois disso não serão aceitas novas inscrições. Quem não estiver inscrito não terá direito a premiação, mesmo terminando no top 3.</p><p><strong>No Beta atual a inscrição é gratuita e somente para testes.</strong></p></section>
<section class="card"><h2>5. 🏆 Premiação</h2><p><strong>Pagantes:</strong> 1º 50% do acumulado; 2º 30%; 3º VIP Ouro por 30 dias.</p><p><strong>Gratuitos:</strong> 1º VIP Ouro; 2º VIP Prata; 3º VIP Bronze.</p><p>Participante gratuito não recebe a parcela em dinheiro; o valor permanece no saldo acumulado.</p></section>
<section class="card"><h2>6. 💰 Garantia mínima de R$300</h2><p>A Season oficial terá premiação mínima garantida de <strong>R$300,00</strong>. Se as inscrições não atingirem esse valor, o Guerra Fria completa a diferença. Acima de R$300, o excedente integra o saldo acumulado.</p><p>Exemplos: 10 × R$20 = R$200 → Guerra Fria completa R$100. 15 × R$20 = R$300. 20 × R$20 = R$400 → R$100 excedentes entram no saldo.</p></section>
<section class="card"><h2>7. 🔄 Saldo acumulado</h2><p>Dinheiro destinado a uma posição ocupada por jogador gratuito não será perdido nem transferido para outro jogador; permanece acumulado. Se o saldo seguinte ficar abaixo de R$300, o Guerra Fria completa a diferença. Se ficar acima, permanece integralmente acumulado.</p></section>
<section class="card"><h2>8. 🏰 Cota do Guerra Fria</h2><p><strong>20% do valor acumulado</strong> será destinado à manutenção, infraestrutura, suporte e custos do servidor. Não representa posição no ranking, não é prêmio do terceiro colocado e não interfere nos prêmios VIP.</p></section>
<section class="card"><h2>9. ✅ Aceitação dos termos</h2><p>Ao clicar em “Inscrever-se”, o jogador declara ciência e aceitação das regras. Na modalidade paga, a confirmação do pagamento de R$20 representa aceitação integral das regras da Season, pontuação, premiação, desclassificação, funcionamento do servidor e demais condições.</p></section>
<section class="card"><h2>10. 🚫 Cancelamento e reembolso</h2><p>Na Season oficial, após a confirmação do pagamento da inscrição de R$20, o jogador não poderá desistir solicitando devolução do valor pago. O jogador deve ler as regras antes do pagamento. <strong>Esta cláusula não se aplica ao Beta, que não possui cobrança.</strong></p></section>
<section class="card"><h2>11. 🛑 Burla ou manipulação</h2><p>Tentativas de manipular pontuação ou ranking, explorar bugs ou falhas, fraudar inscrição, manipular eventos ou obter vantagem irregular poderão resultar em <strong>desclassificação imediata</strong>.</p></section>
<section class="card"><h2>12. 🎮 Uso de cheats</h2><p>Uso comprovado de cheats ou software de trapaça pode resultar em desclassificação. A administração poderá considerar evidências de cheats em outros jogos quando relevantes à integridade da competição.</p></section>
<section class="card"><h2>13. ⚠️ Problemas técnicos</h2><p>Ataques, quedas, lag, instabilidades, bugs do Rust, falhas técnicas e fatores externos podem ocorrer. Essas situações não implicam automaticamente alteração de calendário, duração, pontuação, premiação, ranking, regras ou período de participação.</p></section>
<section class="card"><h2>14. 🔧 Sistema em construção</h2><p>O sistema ainda está em desenvolvimento e poderá apresentar bugs, falhas de contabilização e necessidade de ajustes técnicos. A administração poderá corrigir, rebalancear e melhorar a plataforma. As regras definitivas e os critérios completos serão divulgados antes da Season oficial.</p></section>
<section class="card"><h2>15. 🎥 Encerramento e resultados</h2><p>Ao término da Season oficial será feito o fechamento do ranking e uma live especial apresentará ranking final, vencedores, pontuação e premiações.</p><p><strong>Pagantes:</strong> 🥇 50% • 🥈 30% • 🥉 VIP Ouro 30 dias.</p><p><strong>Gratuitos:</strong> 🥇 VIP Ouro • 🥈 VIP Prata • 🥉 VIP Bronze.</p><p><strong>Guerra Fria:</strong> 20% do valor acumulado para manutenção e operação.</p></section>`;
  const body = `<a class="back" href="/season${season}">← Voltar para Season</a><section class="hero"><div class="ey">REGULAMENTO • GUERRA FRIA</div><h1>Season ${season}</h1><p>Regulamento público da Season Guerra Fria. A versão atual está em construção e a competição em exibição é uma fase Beta.</p></section>${sections}`;
  res.setHeader("Cache-Control", "no-store");
  return void res.status(200).type("html").send(pageShell("Regulamento Season • Guerra Fria", body));
});

export default router;
