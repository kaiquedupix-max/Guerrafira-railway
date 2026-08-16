import { db, modLogsTable } from "@workspace/db";
import { assertWipeUnlocked, getWipeLockState } from "./wipeLock.js";

export type WipeKind = "map" | "general";
export type HostFile = { name: string; path: string; directory: string; size: number; group: "map" | "blueprints" };
export type WipeActor = { id: string; name: string };

const panelUrl = () => String(process.env.ELGAE_PANEL_URL || "").replace(/\/$/, "");
const serverId = () => String(process.env.ELGAE_SERVER_ID || "").trim();
const apiKey = () => String(process.env.ELGAE_API_KEY || "").trim();
const executionEnabled = () => process.env.WIPE_EXECUTION_ENABLED === "true";
const automationEnabled = () => process.env.WIPE_AUTOMATION_ENABLED === "true";

async function panelRequest(path: string, init: RequestInit = {}): Promise<any> {
  if (!panelUrl() || !serverId() || !apiKey()) throw new Error("Integração ElgaeHost incompleta no Railway.");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${panelUrl()}/api/client/servers/${serverId()}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey()}`, Accept: "Application/vnd.pterodactyl.v1+json", "Content-Type": "application/json", ...(init.headers || {}) },
      signal: controller.signal,
    });
    const text = await response.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) throw new Error(`Painel respondeu ${response.status}: ${typeof data === "string" ? data.slice(0,180) : data?.errors?.[0]?.detail || "falha na API"}`);
    return data;
  } finally { clearTimeout(timer); }
}

async function listDirectory(directory: string): Promise<any[]> {
  const data = await panelRequest(`/files/list?directory=${encodeURIComponent(directory)}`);
  return Array.isArray(data?.data) ? data.data.map((entry: any) => entry?.attributes || entry) : [];
}

async function inventoryFiles(root = "/", limit = 1500): Promise<{ entries: string[]; truncated: boolean }> {
  const queue = [root]; const entries: string[] = [];
  while (queue.length && entries.length < limit) {
    const directory = queue.shift()!;
    for (const item of await listDirectory(directory)) {
      const name = String(item.name || ""); if (!name || name === "." || name === "..") continue;
      const path = directory === "/" ? `/${name}` : `${directory}/${name}`;
      entries.push(`${item.is_file === false ? "[DIR] " : "[FILE]"} ${path}${item.is_file === false ? "" : ` (${Number(item.size || 0)} bytes)`}`);
      if (item.is_file === false) queue.push(path);
      if (entries.length >= limit) break;
    }
  }
  return { entries, truncated: queue.length > 0 };
}

export async function testHostFileAccess(actor: WipeActor): Promise<{ success: boolean; testPath: string; created: boolean; visibleAfterCreate: boolean; deleted: boolean; absentAfterDelete: boolean; inventory: string[]; truncated: boolean; steps: string[] }> {
  const name = `.guerra-fria-file-test-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`;
  const testPath = `/${name}`; const steps: string[] = []; let created=false, visibleAfterCreate=false, deleted=false, absentAfterDelete=false;
  try {
    await panelRequest(`/files/write?file=${encodeURIComponent(testPath)}`, { method:"POST", headers:{"Content-Type":"text/plain"}, body:`Teste temporário Guerra Fria\nCriado em: ${new Date().toISOString()}\nAdministrador: ${actor.name} (${actor.id})\n` });
    created=true; steps.push("OK — arquivo temporário criado");
    visibleAfterCreate=(await listDirectory("/")).some(item=>String(item.name)===name && item.is_file!==false);
    if(!visibleAfterCreate)throw new Error("O painel aceitou a escrita, mas o arquivo não apareceu na listagem.");
    steps.push("OK — arquivo encontrado na listagem");
    const inventory=await inventoryFiles(); steps.push(`OK — inventário gerado (${inventory.entries.length} entradas${inventory.truncated?", limitado":""})`);
    await panelRequest("/files/delete", {method:"POST",body:JSON.stringify({root:"/",files:[name]})}); deleted=true; steps.push("OK — arquivo temporário apagado");
    absentAfterDelete=!(await listDirectory("/")).some(item=>String(item.name)===name);
    if(!absentAfterDelete)throw new Error("O arquivo ainda aparece após a exclusão.");
    steps.push("OK — exclusão confirmada por nova listagem");
    await auditWipe("FILE_ACCESS_TEST_OK",actor,`${testPath}; ${inventory.entries.length} entradas listadas.`);
    return {success:true,testPath,created,visibleAfterCreate,deleted,absentAfterDelete,inventory:inventory.entries,truncated:inventory.truncated,steps};
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha desconhecida"; steps.push(`ERRO — ${message}`);
    await auditWipe("FILE_ACCESS_TEST_FAILED",actor,`${testPath}; ${message}`).catch(()=>{}); throw Object.assign(new Error(message),{testReport:{success:false,testPath,created,visibleAfterCreate,deleted,absentAfterDelete,inventory:[],truncated:false,steps}});
  } finally {
    if(!deleted) await panelRequest("/files/delete", {method:"POST",body:JSON.stringify({root:"/",files:[name]})}).catch(()=>null);
  }
}

async function state(): Promise<string> { const data = await panelRequest("/resources"); return String(data?.attributes?.current_state || "unknown"); }
async function waitForState(expected: "offline" | "running", timeoutMs = 120_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) { if (await state() === expected) return; await new Promise(resolve => setTimeout(resolve, 3_000)); }
  throw new Error(`Servidor não chegou ao estado ${expected} dentro do limite.`);
}

export async function resolveRustMapsUrl(input: string): Promise<{ pageUrl: string; mapUrl: string; imageUrl?: string }> {
  let url: URL; try { url = new URL(input.trim()); } catch { throw new Error("Link do RustMaps inválido."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("O link do mapa precisa usar HTTPS.");
  if (/\.map(?:\?|$)/i.test(url.href)) return { pageUrl: url.href, mapUrl: url.href };
  if (!/(^|\.)rustmaps\.com$/i.test(url.hostname)) throw new Error("Use um link do RustMaps ou uma URL direta terminada em .map.");
  const response = await fetch(url.href, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`RustMaps respondeu ${response.status}.`);
  const html = await response.text();
  const candidates = [...html.matchAll(/https?:\\?\/\\?\/[^\s"'<>]+?\.map(?:\?[^\s"'<>]*)?/gi)].map(m => m[0].replace(/\\\//g, "/").replace(/&amp;/g, "&"));
  const mapUrl = candidates.find(candidate => { try { return new URL(candidate).protocol.startsWith("http"); } catch { return false; } });
  const imageUrl = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
  if (!mapUrl) throw new Error("Não encontrei o download .map nessa página. Copie no RustMaps o link direto de download do mapa.");
  return { pageUrl: url.href, mapUrl, imageUrl };
}

async function startupVariables(): Promise<any[]> {
  const data = await panelRequest("/startup"); return Array.isArray(data?.data) ? data.data.map((item: any) => item?.attributes || item) : [];
}
function findLevelUrlVariable(variables: any[]): string | null {
  const aliases = ["LEVEL_URL", "LEVELURL", "SERVER_LEVEL_URL", "CUSTOM_MAP_URL", "MAP_URL"];
  for (const alias of aliases) { const found = variables.find(v => String(v.env_variable || v.name || "").toUpperCase() === alias); if (found) return String(found.env_variable || found.name); }
  return null;
}
function findStartupVariable(variables:any[],aliases:string[]):string|null{
  for(const alias of aliases){const found=variables.find(v=>String(v.env_variable||v.name||"").toUpperCase()===alias);if(found)return String(found.env_variable||found.name)}return null;
}
function proceduralKeys(variables:any[]): {seed:string|null;size:string|null;levelUrl:string|null} {
  return {
    seed:findStartupVariable(variables,["WORLD_SEED","SERVER_SEED","SEED","RUST_SEED"]),
    size:findStartupVariable(variables,["WORLD_SIZE","SERVER_WORLD_SIZE","SERVER_SIZE","WORLD_SIZE_INT","RUST_WORLD_SIZE"]),
    levelUrl:findLevelUrlVariable(variables),
  };
}

export async function diagnoseHost(): Promise<any> {
  const [server, resources, root, variables] = await Promise.all([panelRequest(""), panelRequest("/resources"), listDirectory("/"), startupVariables().catch(() => [])]);
  const keys=proceduralKeys(variables);const levelUrlVariable=keys.levelUrl;
  const lock=await getWipeLockState();return { connected: true, server: { name: server?.attributes?.name || "Rust", identifier: server?.attributes?.identifier || serverId(), state: resources?.attributes?.current_state || "unknown" }, capabilities: { api: true, power: true, backups: true, files: true, startup: Boolean(levelUrlVariable||keys.seed||keys.size), proceduralStartup:Boolean(keys.seed&&keys.size), destructiveEnabled: executionEnabled(), automationEnabled: automationEnabled(),wipeUnlocked:lock.unlocked },wipeLock:lock, levelUrlVariable,seedVariable:keys.seed,sizeVariable:keys.size, root: root.map((entry: any) => ({ name: entry.name, directory: entry.is_file === false, size: Number(entry.size || 0) })).slice(0,100) };
}

async function discoverIdentityDirectories(): Promise<string[]> {
  const entries = await listDirectory("/server").catch(() => []);
  return entries.filter((entry: any) => entry.is_file === false && entry.name && entry.name !== "." && entry.name !== "..").map((entry: any) => `/server/${entry.name}`);
}
function classify(name: string): "map" | "blueprints" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".map") || lower.endsWith(".sav") || /\.sav\.\d+$/.test(lower)) return "map";
  if (lower.includes("player.blueprints") && lower.endsWith(".db")) return "blueprints";
  return null;
}

export async function buildWipePlan(kind: WipeKind, rustMapsUrl?: string): Promise<{ kind: WipeKind; map?: Awaited<ReturnType<typeof resolveRustMapsUrl>>; files: HostFile[]; directories: string[]; totalBytes: number; destructiveEnabled: boolean }> {
  const map = rustMapsUrl ? await resolveRustMapsUrl(rustMapsUrl) : undefined;
  const directories = await discoverIdentityDirectories(); const files: HostFile[] = [];
  for (const directory of directories) for (const entry of await listDirectory(directory)) {
    if (entry.is_file === false) continue; const group = classify(String(entry.name || ""));
    if (!group || (group === "blueprints" && kind !== "general")) continue;
    files.push({ name: String(entry.name), path: `${directory}/${entry.name}`, directory, size: Number(entry.size || 0), group });
  }
  return { kind, map, files, directories, totalBytes: files.reduce((sum,file)=>sum+file.size,0), destructiveEnabled: executionEnabled() };
}

export async function auditWipe(action: string, actor: WipeActor, reason: string): Promise<void> {
  await db.insert(modLogsTable).values({ action, steamId: "SERVER", playerName: "Servidor Guerra Fria", reason, adminId: actor.id, adminName: actor.name });
}
async function createBackup(kind: WipeKind): Promise<string> {
  const created=await panelRequest("/backups", { method: "POST", body: JSON.stringify({ name: `pre-wipe-${kind}-${new Date().toISOString()}`, ignored: "" }) });
  const uuid=String(created?.attributes?.uuid||created?.data?.attributes?.uuid||""); if(!uuid)throw new Error("A host não retornou o identificador do backup.");
  const started=Date.now();
  while(Date.now()-started<15*60_000){
    const data=await panelRequest(`/backups/${uuid}`);const backup=data?.attributes||data?.data?.attributes||data;
    if(backup?.completed_at){if(backup.is_successful===false)throw new Error("O backup de segurança falhou.");return uuid;}
    await new Promise(resolve=>setTimeout(resolve,5_000));
  }
  throw new Error("O backup não terminou dentro de 15 minutos; wipe cancelado.");
}
async function setMapUrl(mapUrl: string): Promise<void> {
  const key = findLevelUrlVariable(await startupVariables()); if (!key) throw new Error("A variável de URL do mapa não foi encontrada na inicialização da host.");
  await panelRequest("/startup/variable", { method: "PUT", body: JSON.stringify({ key, value: mapUrl }) });
  const current=(await startupVariables()).find(v=>String(v.env_variable||v.name||"")===key);
  if(String(current?.server_value||current?.value||"")!==mapUrl)throw new Error("A host não confirmou a nova URL do mapa.");
}
async function setStartupValue(key:string,value:string):Promise<void>{
  await panelRequest("/startup/variable",{method:"PUT",body:JSON.stringify({key,value})});
  const current=(await startupVariables()).find(v=>String(v.env_variable||v.name||"")===key);
  if(String(current?.server_value??current?.value??"")!==value)throw new Error(`A host não confirmou a variável ${key}.`);
}
async function setProceduralMap(seed:number,size:number):Promise<void>{
  const variables=await startupVariables();const keys=proceduralKeys(variables);
  if(!keys.seed||!keys.size)throw new Error("As variáveis de seed e size não foram encontradas no startup do Pterodactyl.");
  if(keys.levelUrl)await setStartupValue(keys.levelUrl,"");
  await setStartupValue(keys.seed,String(seed));await setStartupValue(keys.size,String(size));
}
async function deletePlannedFiles(files: HostFile[]): Promise<void> {
  const grouped = new Map<string,string[]>(); for (const file of files) grouped.set(file.directory, [...(grouped.get(file.directory) || []), file.name]);
  for (const [root, names] of grouped) await panelRequest("/files/delete", { method: "POST", body: JSON.stringify({ root, files: names }) });
  for(const [root,names] of grouped){const remaining=new Set((await listDirectory(root)).map(item=>String(item.name)));const failed=names.filter(name=>remaining.has(name));if(failed.length)throw new Error(`A exclusão não foi confirmada em ${root}: ${failed.join(", ")}`);}
}

export async function restartHostServer(actor:WipeActor):Promise<void>{
  await panelRequest("/power",{method:"POST",body:JSON.stringify({signal:"restart"})});
  await auditWipe("AUTO_RESTART_TRIGGERED",actor,"Reinício diário enviado para a host.");
}

export async function executePreparedWipe(kind: WipeKind, rustMapsUrl: string, actor: WipeActor, automated = false): Promise<{ filesDeleted: number; mapUrl: string }> {
  await assertWipeUnlocked();
  if (!executionEnabled()) throw new Error("Execução bloqueada por WIPE_EXECUTION_ENABLED=false.");
  if (automated && !automationEnabled()) throw new Error("Automação bloqueada por WIPE_AUTOMATION_ENABLED=false.");
  const plan = await buildWipePlan(kind, rustMapsUrl); if (!plan.map?.mapUrl) throw new Error("Mapa não validado.");
  if (!plan.files.some(f => f.group === "map")) throw new Error("Nenhum save de mapa foi localizado; wipe cancelado por segurança.");
  await auditWipe("WIPE_STARTED", actor, `${kind}; ${plan.files.length} arquivos; ${plan.map.pageUrl}`); const backupId=await createBackup(kind);await assertWipeUnlocked();
  await panelRequest("/power", { method: "POST", body: JSON.stringify({ signal: "stop" }) }); await waitForState("offline");
  try {
    await setMapUrl(plan.map.mapUrl); await deletePlannedFiles(plan.files);
    await panelRequest("/power", { method: "POST", body: JSON.stringify({ signal: "start" }) }); await waitForState("running", 180_000);
    await auditWipe("WIPE_COMPLETED", actor, `${kind}; ${plan.files.length} arquivos; mapa ${plan.map.pageUrl}; backup ${backupId}`); return { filesDeleted: plan.files.length, mapUrl: plan.map.mapUrl };
  } catch (error) {
    await panelRequest("/power", { method: "POST", body: JSON.stringify({ signal: "start" }) }).catch(() => null);
    await auditWipe("WIPE_FAILED", actor, error instanceof Error ? error.message : "Falha desconhecida"); throw error;
  }
}

export async function executePreparedProceduralWipe(kind:WipeKind,seed:number,size:number,actor:WipeActor,automated=false):Promise<{filesDeleted:number;seed:number;size:number}>{
  await assertWipeUnlocked();
  if(!Number.isInteger(seed)||seed<0||seed>2147483647)throw new Error("Seed inválida.");
  if(!Number.isInteger(size)||size<1000||size>6000)throw new Error("Size deve estar entre 1000 e 6000.");
  if(!executionEnabled())throw new Error("Execução bloqueada por WIPE_EXECUTION_ENABLED=false.");
  if(automated&&!automationEnabled())throw new Error("Automação bloqueada por WIPE_AUTOMATION_ENABLED=false.");
  const plan=await buildWipePlan(kind);if(!plan.files.some(f=>f.group==="map"))throw new Error("Nenhum save de mapa foi localizado; wipe cancelado por segurança.");
  await auditWipe("WIPE_STARTED",actor,`${kind}; ${plan.files.length} arquivos; seed ${seed}; size ${size}`);const backupId=await createBackup(kind);await assertWipeUnlocked();
  await panelRequest("/power",{method:"POST",body:JSON.stringify({signal:"stop"})});await waitForState("offline");
  try{await setProceduralMap(seed,size);await deletePlannedFiles(plan.files);await panelRequest("/power",{method:"POST",body:JSON.stringify({signal:"start"})});await waitForState("running",180_000);await auditWipe("WIPE_COMPLETED",actor,`${kind}; ${plan.files.length} arquivos; seed ${seed}; size ${size}; backup ${backupId}`);return{filesDeleted:plan.files.length,seed,size};}
  catch(error){await panelRequest("/power",{method:"POST",body:JSON.stringify({signal:"start"})}).catch(()=>null);await auditWipe("WIPE_FAILED",actor,error instanceof Error?error.message:"Falha desconhecida");throw error;}
}

export async function executeWipe(kind: WipeKind, rustMapsUrl: string, confirmation: string, actor: WipeActor): Promise<{ filesDeleted: number; mapUrl: string }> {
  if (confirmation !== "WIPE GUERRA FRIA") throw new Error("Confirmação inválida."); return executePreparedWipe(kind, rustMapsUrl, actor, false);
}
