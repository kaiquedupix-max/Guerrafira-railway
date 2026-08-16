import { db, modLogsTable } from "@workspace/db";

export type WipeKind = "map" | "map_players" | "full";
export type HostFile = { name: string; path: string; directory: string; size: number };

const panelUrl = () => String(process.env.ELGAE_PANEL_URL || "").replace(/\/$/, "");
const serverId = () => String(process.env.ELGAE_SERVER_ID || "").trim();
const apiKey = () => String(process.env.ELGAE_API_KEY || "").trim();

async function panelRequest(path: string, init: RequestInit = {}): Promise<any> {
  if (!panelUrl() || !serverId() || !apiKey()) throw new Error("Integração ElgaeHost incompleta no Railway.");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${panelUrl()}/api/client/servers/${serverId()}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey()}`, Accept: "Application/vnd.pterodactyl.v1+json", "Content-Type": "application/json", ...(init.headers || {}) },
      signal: controller.signal,
    });
    const text = await response.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) throw new Error(`Painel respondeu ${response.status}: ${typeof data === "string" ? data.slice(0,160) : data?.errors?.[0]?.detail || "falha na API"}`);
    return data;
  } finally { clearTimeout(timer); }
}

async function listDirectory(directory: string): Promise<any[]> {
  const data = await panelRequest(`/files/list?directory=${encodeURIComponent(directory)}`);
  return Array.isArray(data?.data) ? data.data.map((entry: any) => entry?.attributes || entry) : [];
}

export async function diagnoseHost(): Promise<any> {
  const [server, resources, root] = await Promise.all([
    panelRequest(""), panelRequest("/resources"), listDirectory("/")
  ]);
  return {
    connected: true,
    server: { name: server?.attributes?.name || "Rust", identifier: server?.attributes?.identifier || serverId(), state: resources?.attributes?.current_state || "unknown" },
    capabilities: { api: true, power: true, backups: true, files: true, destructiveEnabled: process.env.WIPE_EXECUTION_ENABLED === "true" },
    root: root.map((entry: any) => ({ name: entry.name, directory: Boolean(entry.is_file === false), size: Number(entry.size || 0) })).slice(0,100),
  };
}

async function discoverIdentityDirectories(): Promise<string[]> {
  const serverEntries = await listDirectory("/server").catch(() => []);
  return serverEntries.filter((entry: any) => entry.is_file === false && entry.name && entry.name !== "." && entry.name !== "..").map((entry: any) => `/server/${entry.name}`);
}

function classify(name: string): "map" | "players" | "blueprints" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".map") || lower.endsWith(".sav") || /\.sav\.\d+$/.test(lower)) return "map";
  if (lower.includes("player.blueprints") && lower.endsWith(".db")) return "blueprints";
  if ((lower.includes("player.identities") || lower.includes("player.states") || lower.includes("player.deaths")) && lower.endsWith(".db")) return "players";
  return null;
}

export async function buildWipePlan(kind: WipeKind): Promise<{ kind: WipeKind; files: HostFile[]; directories: string[]; totalBytes: number; destructiveEnabled: boolean }> {
  const directories = await discoverIdentityDirectories(); const files: HostFile[] = [];
  for (const directory of directories) {
    const entries = await listDirectory(directory);
    for (const entry of entries) {
      if (entry.is_file === false) continue;
      const group = classify(String(entry.name || ""));
      const include = group === "map" || (kind !== "map" && group === "players") || (kind === "full" && group === "blueprints");
      if (include) files.push({ name: String(entry.name), path: `${directory}/${entry.name}`, directory, size: Number(entry.size || 0) });
    }
  }
  return { kind, files, directories, totalBytes: files.reduce((sum,file)=>sum+file.size,0), destructiveEnabled: process.env.WIPE_EXECUTION_ENABLED === "true" };
}

export async function auditWipe(action: string, actor: { id: string; name: string }, reason: string): Promise<void> {
  await db.insert(modLogsTable).values({ action, steamId: "SERVER", playerName: "Servidor Guerra Fria", reason, adminId: actor.id, adminName: actor.name });
}

export async function executeWipe(kind: WipeKind, confirmation: string, actor: { id: string; name: string }): Promise<never> {
  const plan = await buildWipePlan(kind);
  await auditWipe("WIPE_EXECUTION_BLOCKED", actor, `Tentativa ${kind}; ${plan.files.length} arquivos planejados; modo seguro ativo.`);
  if (confirmation !== "WIPE GUERRA FRIA") throw new Error("Confirmação inválida.");
  if (process.env.WIPE_EXECUTION_ENABLED !== "true") throw new Error("Execução destrutiva bloqueada. O sistema está pronto apenas para diagnóstico e planejamento.");
  // A execução real será liberada somente no dia do wipe, após validação final
  // do backup e da lista produzida pelo planejamento. Nenhuma exclusão ocorre aqui.
  throw new Error("Bloqueio de segurança final ativo: liberação manual necessária no código.");
}
