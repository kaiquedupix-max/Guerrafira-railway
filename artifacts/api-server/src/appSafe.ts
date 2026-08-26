import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import webhookRouter from "./routes/webhook.js";
import { leaderboardHtml } from "./routes/leaderboardV2";
import { renderSeasonPage } from "./routes/seasonPage.js";
import { renderSeasonGuide } from "./routes/seasonGuide.js";
import { renderAdmin } from "./admin/appRenderShim.js";
import { renderCommunityPage } from "./admin/communityPage.js";
import { renderHome } from "./admin/homePageEnhanced.js";
import { renderStorePage } from "./admin/storePage.js";
import { withSiteChrome } from "./admin/siteChrome.js";
import { getCommunitySession } from "./admin/communitySession.js";
import { getAdminSessionV3, issueAdminSessionV3 } from "./admin/sessionBearer.js";
import { logger } from "./lib/logger";
import { startStoragePolicy } from "./storagePolicy.js";

if (process.env.PTERODACTYL_URL) process.env.ELGAE_PANEL_URL = process.env.PTERODACTYL_URL;
if (process.env.PTERODACTYL_SERVER_ID) process.env.ELGAE_SERVER_ID = process.env.PTERODACTYL_SERVER_ID;
if (process.env.PTERODACTYL_API_KEY) process.env.ELGAE_API_KEY = process.env.PTERODACTYL_API_KEY;

const SEASON_1_START_AT = Date.parse("2026-09-03T00:00:00-03:00");

function isSeasonAdmin(req: express.Request): boolean {
  return Boolean(getCommunitySession(req)?.isAdmin || getAdminSessionV3(req));
}

function isSeasonPublic(seasonNumber: number): boolean {
  return seasonNumber !== 1 || Date.now() >= SEASON_1_START_AT;
}

function renderSeasonComingSoon(): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#08060d"><title>Em breve • Guerra Fria</title><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#08060d;color:#fff;font-family:Inter,system-ui,-apple-system,sans-serif}body{min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 30%,#28163a 0,#120b19 34%,#08060d 72%)}h1{margin:0;font-size:clamp(42px,12vw,92px);letter-spacing:-.055em;font-weight:1000;text-align:center}</style></head><body><h1>Em breve</h1></body></html>`;
}

function enhanceSeasonGuide(html: string, seasonNumber: number): string {
  const n = Math.max(1, Math.trunc(Number(seasonNumber) || 1));
  const rankSection = `<section class="section" id="patentes"><h2>🎖️ Patentes da Season</h2><div class="body"><p>Além da posição geral no ranking, cada jogador terá uma <strong>patente baseada no MMR atual</strong>. Quando o jogador alcançar a pontuação mínima exigida para a próxima classificação, a patente sobe automaticamente.</p><div class="notice"><strong>As faixas de MMR ainda estão em definição.</strong> Por enquanto, nenhuma pontuação mínima foi publicada. A tabela oficial de classificação será divulgada antes da abertura competitiva da Season.</div><div class="rankgrid"><div class="rankcard"><span class="rankicon">🪖</span><b>Recruta</b><small>MMR necessário: em definição</small></div><div class="rankcard"><span class="rankicon">🎖️</span><b>Soldado I</b><small>Classificação em definição</small></div><div class="rankcard"><span class="rankicon">🎖️🎖️</span><b>Soldado II</b><small>Classificação em definição</small></div><div class="rankcard"><span class="rankicon">🎖️🎖️🎖️</span><b>Soldado III</b><small>Classificação em definição</small></div><div class="rankcard"><span class="rankicon">🛡️</span><b>Sargento I</b><small>Classificação em definição</small></div><div class="rankcard"><span class="rankicon">🛡️🛡️</span><b>Sargento II</b><small>Classificação em definição</small></div><div class="rankcard"><span class="rankicon">🛡️🛡️🛡️</span><b>Sargento III</b><small>Classificação em definição</small></div><div class="rankcard"><span class="rankicon">⭐</span><b>Tenente I</b><small>Classificação em definição</small></div><div class="rankcard"><span class="rankicon">⭐⭐</span><b>Tenente II</b><small>Classificação em definição</small></div><div class="rankcard"><span class="rankicon">⭐⭐⭐</span><b>Tenente III</b><small>Classificação em definição</small></div><div class="rankcard"><span class="rankicon">🦅</span><b>Coronel I</b><small>Classificação em definição</small></div><div class="rankcard"><span class="rankicon">🦅🦅</span><b>Coronel II</b><small>Classificação em definição</small></div><div class="rankcard"><span class="rankicon">🦅🦅🦅</span><b>Coronel III</b><small>Classificação em definição</small></div><div class="rankcard elite"><span class="rankicon">🏅</span><b>Marechal</b><small>Classificação em definição</small></div><div class="rankcard war"><span class="five">★★★★★</span><b>General de Guerra</b><small>Patente máxima • classificação em definição</small></div></div><div class="drawing"><div class="drawtitle">COMO A PROMOÇÃO FUNCIONA</div><div class="flow"><div class="node"><span class="ico">🎮</span><b>Você joga</b><small>ações válidas geram ou retiram MMR</small></div><div class="arrow">→</div><div class="node"><span class="ico">📈</span><b>MMR muda</b><small>o ranking é atualizado</small></div><div class="arrow">→</div><div class="node"><span class="ico">🎖️</span><b>Atingiu a faixa</b><small>promoção automática</small></div><div class="arrow">→</div><div class="node result"><span class="ico">🏆</span><b>Nova patente</b><small>aparece no perfil e ranking</small></div></div></div><p>A patente acompanha o <strong>MMR real do jogador</strong>. Portanto, a progressão não depende de tempo jogado, quantidade de kills isolada ou compra de VIP. O que importa é a pontuação calculada pelo sistema da Season. As regras finais de promoção e eventual rebaixamento serão publicadas junto das faixas oficiais.</p></div></section>`;

  const faqExtra = `<details><summary>Como eu subo de patente?</summary><p>Jogando normalmente e acumulando MMR pelas ações válidas da Season. Quando seu MMR atingir a faixa exigida para a próxima patente, a promoção será automática.</p></details><details><summary>Qual MMR precisa para Soldado, Sargento, Coronel ou Marechal?</summary><p>As pontuações mínimas ainda estão sendo definidas. Nenhum número exibido antes da tabela oficial deve ser considerado requisito definitivo.</p></details><details><summary>Qual é a patente máxima?</summary><p>A patente máxima será <strong>General de Guerra</strong>, representada por cinco estrelas (★★★★★), acima de Marechal.</p></details><details><summary>Posso perder uma patente?</summary><p>O sistema acompanhará o MMR atual do jogador. A regra definitiva de rebaixamento ainda será publicada junto com as faixas oficiais de MMR.</p></details>`;

  html = html.replace("</style>",`.rankgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:16px 0}.rankcard{min-height:112px;background:linear-gradient(145deg,#12151b,#0c0e12);border:1px solid #303642;border-radius:14px;padding:14px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}.rankcard b{font-size:14px;color:#fff;margin-top:7px}.rankcard small{font-size:10px;color:#8f98a8;margin-top:4px}.rankicon{font-size:22px;min-height:27px}.rankcard.elite{border-color:#8a6823;background:linear-gradient(145deg,#211a0c,#10100d)}.rankcard.war{grid-column:span 3;border-color:#a98b37;background:radial-gradient(circle at 50% 0,#3b3112,#17140c 48%,#0d0e11);box-shadow:0 0 34px #d4af3730}.rankcard.war b{font-size:18px}.five{font-size:24px;letter-spacing:.12em;color:#f6d365;text-shadow:0 0 14px #f6d36570}@media(max-width:700px){.rankgrid{grid-template-columns:repeat(2,1fr)}.rankcard.war{grid-column:span 2}}</style>`);
  html = html.replace('<a href="#faq">FAQ</a>', '<a href="#patentes">Patentes</a><a href="#faq">FAQ</a>');
  html = html.replace('<section class="section" id="faq">', rankSection + '<section class="section" id="faq">');
  html = html.replace('</section><div class="foot">', faqExtra + '</section><div class="foot">');
  html = html.replace('GF • GUIA DO MMR', `GF • SEASON ${n} • GUIA DO MMR`);
  return html;
}

const app: Express = express();
startStoragePolicy();
app.use(pinoHttp({logger,serializers:{req(req){return{id:req.id,method:req.method,url:req.url?.split("?")[0]};},res(res){return{statusCode:res.statusCode};}}}));
app.use(cors()); app.use(cookieParser()); app.use(express.json({limit:"18mb"})); app.use(express.urlencoded({extended:true}));
app.use((req,res,next)=>{if(req.path.startsWith("/admin")||req.path.startsWith("/painel")||req.path.startsWith("/api/admin")){res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");res.setHeader("Pragma","no-cache");res.setHeader("Expires","0");}next();});
app.get("/",(req,res)=>res.status(200).type("html").send(renderHome(req)));
app.get("/leaderboard",(req,res)=>{const session=getCommunitySession(req);return res.status(200).type("html").send(session?withSiteChrome(leaderboardHtml,"leaderboard",{isAdmin:session.isAdmin,username:session.username}):leaderboardHtml);});

// Guia/FAQ permanece público antes da abertura da Season 1.
app.get("/season:seasonNumber/guia",(req,res)=>{const n=Math.max(1,Math.trunc(Number(req.params.seasonNumber)||1));const community=getCommunitySession(req);const admin=getAdminSessionV3(req);let html=enhanceSeasonGuide(renderSeasonGuide(n),n);html=html.replace("</style>",`.top{top:68px}.hero{padding-top:64px}.hero:after{content:'SEASON 1 • INÍCIO 03/09/2026';display:inline-flex;margin-top:18px;padding:8px 12px;border-radius:999px;border:1px solid #6b4587;background:#1c1027;color:#e2c9ff;font-size:10px;font-weight:950;letter-spacing:.12em}.section{box-shadow:0 18px 50px #0004}.q,.box,.drawing{transition:transform .18s,border-color .18s}.q:hover,.box:hover,.drawing:hover{transform:translateY(-2px);border-color:#6b4587}@media(max-width:760px){.top{top:0}.hero{padding-top:38px}}</style>`);html=withSiteChrome(html,"season",{isAdmin:Boolean(community?.isAdmin||admin),username:community?.username||admin?.username||""});res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");return res.status(200).type("html").send(html);});

app.get("/season:seasonNumber",(req,res)=>{const n=Math.max(1,Math.trunc(Number(req.params.seasonNumber)||1));res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");if(!isSeasonPublic(n)&&!isSeasonAdmin(req))return res.status(200).type("html").send(renderSeasonComingSoon());let html=renderSeasonPage(n);const guide=`<section style="margin:22px 0;border:1px solid #7046a0;background:linear-gradient(135deg,#21122f,#0d0f13);border-radius:18px;padding:20px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;box-shadow:0 20px 60px #0005"><div><div style="font-size:11px;font-weight:950;letter-spacing:.15em;color:#d9bfff">📖 GUIA OFICIAL + FAQ</div><div style="font-size:22px;font-weight:950;margin-top:5px">Como funciona o MMR?</div><div style="font-size:12px;color:#b5bac3;max-width:680px;line-height:1.55;margin-top:5px">Armas, headshot, distância, pelados, mortes, farm, raid, construção, eventos, bots, animais, anti-farm e patentes explicados passo a passo.</div></div><a href="/season${n}/guia" style="text-decoration:none;background:linear-gradient(135deg,#7c3aed,#5b21b6);border:1px solid #a78bfa;color:white;padding:12px 16px;border-radius:11px;font-size:12px;font-weight:950">ABRIR GUIA →</a></section>`;html=html.replace("</main>",guide+"</main>");const community=getCommunitySession(req);const admin=getAdminSessionV3(req);html=withSiteChrome(html,"season",{isAdmin:Boolean(community?.isAdmin||admin),username:community?.username||admin?.username||""});return res.status(200).type("html").send(html);});

app.get("/loja",(req,res)=>{const session=getCommunitySession(req);if(!session)return res.redirect("/api/admin/auth/login?target=store");return res.status(200).type("html").send(withSiteChrome(renderStorePage(session.username),"home",{isAdmin:session.isAdmin,username:session.username}));});
const renderIntegrity=(req:express.Request,res:express.Response)=>{const session=getCommunitySession(req);const html=renderCommunityPage(req);return res.status(200).type("html").send(session?withSiteChrome(html,"integrity",{isAdmin:session.isAdmin,username:session.username}):html);};
app.get("/integridade",renderIntegrity);app.get("/auditoria",renderIntegrity);app.get("/comunidade",(req,res)=>res.redirect(301,"/integridade"));
const renderAdminPanel=(req:express.Request,res:express.Response)=>{let admin=getAdminSessionV3(req);if(!admin){const community=getCommunitySession(req);if(community?.isAdmin){issueAdminSessionV3(res,community.userId,community.username);return res.redirect("/painel");}return res.redirect("/api/admin/auth/login?target=admin");}return res.status(200).type("html").send(withSiteChrome(renderAdmin(req),"admin",{isAdmin:true,username:admin.username}));};
app.get("/painel",renderAdminPanel);app.get("/admin",(req,res)=>res.redirect(302,"/painel"));
app.get("/status",(_req,res)=>res.status(200).json({status:"ok",service:"guerra-fria"}));app.use("/api",router);app.use("/webhook",webhookRouter);
export default app;