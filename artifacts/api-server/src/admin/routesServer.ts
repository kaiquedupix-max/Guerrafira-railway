import { Router } from "express";
import { executeRconCommand, getOnlinePlayers, getServerInfo } from "../bot/utils/rcon.js";
import { ActionError, executeRconRequired } from "../core/systemActions.js";
import { getSlotControlSettings, updateSlotControlSettings } from "../bot/slotManager.js";
import { requireAdmin } from "./guard.js";
import { addModeratorChat, getLiveChat, getLiveEvents, initLiveOps } from "./liveOps.js";
import { getGuerraFriaDisplayName } from "./permissions.js";
import { notifySubscribedAdmins } from "./adminNotifications.js";
import { controlHostPower, getHostPowerState, getHostResourceSnapshot, type HostPowerSignal } from "../core/hostWipe.js";
import { sendGameAnnouncement } from "../bot/utils/gameAnnouncement.js";

const router = Router();
router.use(requireAdmin);
initLiveOps();
const steamRe = /^7656119\d{10}$/;
const clean = (v: unknown, n = 300) => String(v ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, n);
let itemCache: Array<{ id: number; shortname: string; name: string; category?: string; stack?: number }> = [];
let itemCacheAt = 0;
let warnedRestart: { timer: ReturnType<typeof setTimeout>; executeAt: number; requestedBy: string } | null = null;
let telemetry={rxMbps:0,txMbps:0,baselineRxMbps:0,suspected:false,consecutiveSpikes:0,normalSamples:0,thresholdMbps:Number(process.env.DDOS_ALERT_MBPS)||50,updatedAt:0};
let previousNetwork:{at:number;rx:number;tx:number}|null=null;
let lastResource:Awaited<ReturnType<typeof getHostResourceSnapshot>>|null=null;
let antibot={available:false,attackMode:false,attemptsPerSecond:0,attemptsLast5Seconds:0,uniqueIpsLastMinute:0,blockedIps:0,monitoredIps:0,rejected:0,allowed:0,updatedAt:0};
let lastAntibotAttack=false;

const powerActor = (res: any) => ({
  id: String(res.locals.admin?.userId || "ADMIN_PANEL"),
  name: String(res.locals.admin?.username || "Administrador"),
});
async function restartWarning(message: string): Promise<void> {
  await sendGameAnnouncement("ADMINISTRACAO",message);
}

async function sampleAntibot():Promise<void>{
  try{
    const raw=await executeRconCommand("antibot.json");
    if(!raw)throw new Error("sem resposta");
    const text=String(raw),start=text.indexOf("{"),end=text.lastIndexOf("}");
    if(start<0||end<start)throw new Error("resposta inválida");
    const d=JSON.parse(text.slice(start,end+1));
    antibot={
      available:true,
      attackMode:Boolean(d.attackMode),
      attemptsPerSecond:Number(d.attemptsPerSecond)||0,
      attemptsLast5Seconds:Number(d.attemptsLast5Seconds)||0,
      uniqueIpsLastMinute:Number(d.uniqueIpsLastMinute)||0,
      blockedIps:Number(d.blockedIps)||0,
      monitoredIps:Number(d.monitoredIps)||0,
      rejected:Number(d.rejected)||0,
      allowed:Number(d.allowed)||0,
      updatedAt:Date.now(),
    };
    if(antibot.attackMode&&!lastAntibotAttack){
      void notifySubscribedAdmins({
        kind:"system",
        title:"🚨 Ataque de bots L7 detectado",
        message:`O GuerraFriaAntiBot entrou em modo de ataque. ${antibot.attemptsPerSecond.toFixed(1)} conexões/s, ${antibot.uniqueIpsLastMinute} IPs únicos no último minuto e ${antibot.blockedIps} IPs bloqueados agora.`,
        severity:"critical",
      }).catch(()=>{});
    }
    if(!antibot.attackMode&&lastAntibotAttack){
      void notifySubscribedAdmins({
        kind:"system",
        title:"✅ Ataque L7 normalizado",
        message:`O volume de conexões voltou ao normal. Última leitura: ${antibot.attemptsPerSecond.toFixed(1)} conexões/s e ${antibot.uniqueIpsLastMinute} IPs únicos/min.`,
        severity:"success",
      }).catch(()=>{});
    }
    lastAntibotAttack=antibot.attackMode;
  }catch{
    antibot={...antibot,available:false,updatedAt:Date.now()};
  }
}

async function sampleTelemetry():Promise<void>{
  try{
    const current=await getHostResourceSnapshot(),now=Date.now();lastResource=current;
    if(previousNetwork&&now>previousNetwork.at&&current.networkRxBytes>=previousNetwork.rx&&current.networkTxBytes>=previousNetwork.tx){
      const seconds=(now-previousNetwork.at)/1000;
      telemetry.rxMbps=(current.networkRxBytes-previousNetwork.rx)*8/seconds/1_000_000;
      telemetry.txMbps=(current.networkTxBytes-previousNetwork.tx)*8/seconds/1_000_000;
      if(!telemetry.baselineRxMbps)telemetry.baselineRxMbps=telemetry.rxMbps;
      const dynamicThreshold=Math.max(telemetry.thresholdMbps,telemetry.baselineRxMbps*8);
      const spike=telemetry.rxMbps>=dynamicThreshold;
      if(spike){telemetry.consecutiveSpikes++;telemetry.normalSamples=0}else{telemetry.consecutiveSpikes=0;telemetry.normalSamples++;telemetry.baselineRxMbps=telemetry.baselineRxMbps*.92+telemetry.rxMbps*.08}
      if(!telemetry.suspected&&telemetry.consecutiveSpikes>=3){telemetry.suspected=true;void notifySubscribedAdmins({kind:"system",title:"Possível ataque de rede",message:`Tráfego de entrada anormal: ${telemetry.rxMbps.toFixed(1)} Mbps. Verifique a proteção DDoS da hospedagem.`,severity:"critical"}).catch(()=>{})}
      if(telemetry.suspected&&telemetry.normalSamples>=6)telemetry.suspected=false;
    }
    previousNetwork={at:now,rx:current.networkRxBytes,tx:current.networkTxBytes};telemetry.updatedAt=now;
  }catch{}
}
setTimeout(()=>sampleTelemetry().catch(()=>{}),1_000);
setTimeout(()=>sampleAntibot().catch(()=>{}),2_000);
setInterval(()=>sampleTelemetry().catch(()=>{}),10_000);
setInterval(()=>sampleAntibot().catch(()=>{}),5_000);

router.get("/power/status", async (_req, res) => {
  try { if(!lastResource)await sampleTelemetry();const resource=lastResource||await getHostResourceSnapshot();res.json({ state: resource.state,uptime:resource.uptime,network:{rxMbps:telemetry.rxMbps,txMbps:telemetry.txMbps,rxBytes:resource.networkRxBytes,txBytes:resource.networkTxBytes},security:{status:(telemetry.suspected||antibot.attackMode)?"suspected":"normal",networkSuspected:telemetry.suspected,l7Attack:antibot.attackMode,thresholdMbps:Math.max(telemetry.thresholdMbps,telemetry.baselineRxMbps*8),updatedAt:Math.max(telemetry.updatedAt,antibot.updatedAt),note:"Detector combinado: banda da host + telemetria de conexões do GuerraFriaAntiBot."},antibot, scheduledRestart: warnedRestart ? { executeAt: warnedRestart.executeAt, requestedBy: warnedRestart.requestedBy } : null }); }
  catch (error: any) { res.status(502).json({ error: error?.message || "Não foi possível consultar o servidor." }); }
});

router.post("/power", async (req, res) => {
  const signal = String(req.body?.signal || "") as HostPowerSignal;
  if (!["start", "stop", "restart"].includes(signal)) return void res.status(400).json({ error: "Ação de energia inválida." });
  try {
    if (warnedRestart) { clearTimeout(warnedRestart.timer); warnedRestart = null; }
    const result = await controlHostPower(signal, powerActor(res));
    res.json({ ok: true, ...result });
  } catch (error: any) { res.status(502).json({ error: error?.message || "A host não confirmou a ação." }); }
});

router.post("/restart-warning", async (req, res) => {
  const minutes = Number(req.body?.minutes);
  if (![1, 5, 15].includes(minutes)) return void res.status(400).json({ error: "Escolha 1, 5 ou 15 minutos." });
  if (warnedRestart) return void res.status(409).json({ error: "Já existe um reinício com aviso agendado." });
  const actor = powerActor(res), executeAt = Date.now() + minutes * 60_000;
  try { await restartWarning(`Servidor reiniciando em ${minutes} minuto${minutes === 1 ? "" : "s"}.`); }
  catch (error: any) { return void res.status(503).json({ error: error?.message || "Não foi possível avisar o jogo." }); }
  const checkpoints = [300, 60, 30, 15, 10, 5].filter(seconds => seconds < minutes * 60);
  for (const seconds of checkpoints) setTimeout(() => {
    if (!warnedRestart || warnedRestart.executeAt !== executeAt) return;
    restartWarning(seconds >= 60 ? "Servidor reiniciando em 1 minuto." : `Servidor reiniciando em ${seconds} segundos.`).catch(() => {});
  }, minutes * 60_000 - seconds * 1_000);
  const timer = setTimeout(async () => {
    try { await restartWarning("Reiniciando o servidor agora."); await controlHostPower("restart", actor); }
    catch (error) {
      void notifySubscribedAdmins({ kind: "system", title: "Falha no reinício do servidor", message: error instanceof Error ? error.message : "A host não confirmou o reinício.", severity: "critical" }).catch(() => {});
    }
    finally { warnedRestart = null; }
  }, minutes * 60_000);
  warnedRestart = { timer, executeAt, requestedBy: actor.name };
  res.status(202).json({ ok: true, executeAt, requestedBy: actor.name });
});

router.get("/online", async (_req, res) => {
  const [players, info] = await Promise.all([getOnlinePlayers().catch(() => []), getServerInfo().catch(() => null)]);
  res.json({ players, info });
});

router.get("/slot-control", async (_req, res) => {
  try {
    const [settings, info] = await Promise.all([
      getSlotControlSettings(),
      getServerInfo().catch(() => null),
    ]);
    res.json({ settings, info });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Não foi possível carregar o controle de slots." });
  }
});

router.post("/slot-control", async (req, res) => {
  const admin = res.locals.admin as { userId?: string; username?: string };
  try {
    const mode = req.body?.mode === "manual" ? "manual" : "automatic";
    const minSlots = Number(req.body?.minSlots);
    const maxSlots = Number(req.body?.maxSlots);
    const manualSlots = Number(req.body?.manualSlots);
    const displayName = admin.userId
      ? await getGuerraFriaDisplayName(admin.userId, admin.username || "Administrador")
      : (admin.username || "Administrador");

    const result = await updateSlotControlSettings({
      mode,
      minSlots,
      maxSlots,
      manualSlots,
      updatedBy: displayName,
    });

    const description = mode === "automatic"
      ? `${displayName} ativou o controle automático de slots (${result.settings.minSlots}–${result.settings.maxSlots}).`
      : `${displayName} definiu o controle manual em ${result.settings.manualSlots} slots.`;

    void notifySubscribedAdmins({
      kind: "system",
      title: "🎛️ Controle de slots alterado",
      message: description,
      severity: "info",
    }).catch(() => {});

    res.json({ ok: true, ...result });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "Configuração de slots inválida." });
  }
});

router.get("/items", async (req, res) => {
  const q = clean(req.query.q, 80).toLowerCase();
  if (!itemCache.length || Date.now() - itemCacheAt > 15 * 60_000) {
    const raw = await executeRconCommand("gf.items").catch(() => null);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          itemCache = parsed.filter(x => x && x.shortname && x.name);
          itemCacheAt = Date.now();
        }
      } catch {}
    }
  }
  if (!itemCache.length) return res.status(503).json({ error: "Catálogo de itens indisponível. Instale o plugin GuerraFriaItemCatalog.cs no servidor Rust.", items: [] });
  const items = (q ? itemCache.filter(x => String(x.name).toLowerCase().includes(q) || String(x.shortname).toLowerCase().includes(q) || String(x.category ?? "").toLowerCase().includes(q)) : itemCache).slice(0, 80);
  res.json({ items, total: itemCache.length });
});

router.get("/chat", (_req, res) => res.json({ messages: getLiveChat() }));
router.post("/chat", async (req, res) => {
  const message = clean(req.body?.message, 220);
  if (!message) return res.status(400).json({ error: "Mensagem vazia." });

  const admin = res.locals.admin as { userId?: string; username?: string };
  const displayName = admin.userId ? await getGuerraFriaDisplayName(admin.userId, admin.username || "Administrador") : (admin.username || "Administrador");
  const safeAdmin = clean(displayName, 40).replace(/"/g, "'");
  const safeMessage = message.replace(/"/g, "'");

  const formatted = `<color=red>[Administração]</color> <color=orange>${safeAdmin}:</color> <color=#D8B4FE>${safeMessage}</color>`;
  addModeratorChat(`Administração • ${safeAdmin}`, message);

  let result = await executeRconCommand(`say "${formatted}"`).catch(() => null);
  if (result === null) result = await executeRconCommand(`global.say "${formatted}"`).catch(() => null);

  if (result === null) return res.status(503).json({ error: "O RCON não confirmou o envio da mensagem ao jogo." });
  res.json({ ok: true, rcon: true });
});
router.get("/events", (_req, res) => res.json({ events: getLiveEvents() }));

async function runGameCommand(res: any, command: string): Promise<void> {
  try {
    const result = await executeRconRequired(command);
    res.json({ ok: true, result });
  } catch (error) {
    const e = error instanceof ActionError ? error : new ActionError("O servidor não confirmou o comando.", 503);
    res.status(e.status).json({ error: e.message });
  }
}

router.post("/say", async (req, res) => {
  const message = clean(req.body?.message, 220);
  if (!message) return res.status(400).json({ error: "Mensagem vazia." });
  await runGameCommand(res, `say ${message}`);
});
router.post("/give", async (req, res) => {
  const steamId = clean(req.body?.steamId, 17), item = clean(req.body?.item, 80), amount = Math.max(1, Math.min(100000, Number(req.body?.amount) || 1));
  if (!steamRe.test(steamId) || !/^[a-z0-9._-]+$/i.test(item)) return res.status(400).json({ error: "SteamID ou item inválido." });
  await runGameCommand(res, `inventory.giveto ${steamId} ${item} ${amount}`);
});
router.post("/clear-inventory", async (req, res) => {
  const steamId = clean(req.body?.steamId, 17);
  if (!steamRe.test(steamId)) return res.status(400).json({ error: "SteamID inválido." });
  await runGameCommand(res, `inventory.clearinventory ${steamId}`);
});
router.post("/teleport", async (req, res) => {
  const from = clean(req.body?.from, 17), to = clean(req.body?.to, 17);
  if (!steamRe.test(from) || !steamRe.test(to)) return res.status(400).json({ error: "SteamID inválido." });
  await runGameCommand(res, `teleport ${from} ${to}`);
});
router.post("/spawn", async (req, res) => {
  const entity = clean(req.body?.entity, 120);
  if (!/^[a-z0-9_./-]+$/i.test(entity)) return res.status(400).json({ error: "Entidade inválida." });
  await runGameCommand(res, `spawn ${entity}`);
});
router.post("/rcon", async (req, res) => {
  const command = clean(req.body?.command, 500);
  if (!command) return res.status(400).json({ error: "Comando vazio." });
  if (/^(quit|restart|server\.identity|rcon\.)\b/i.test(command)) return res.status(403).json({ error: "Este comando crítico foi bloqueado no painel web." });
  await runGameCommand(res, command);
});
export default router;
