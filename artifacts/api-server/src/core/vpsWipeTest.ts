export type VpsWipeTestResult = {
  filesDeleted: number;
  seed: number;
  size: number;
  mapFile: string;
  backupId: string;
};

const TEST_PANEL_URL = "https://painel-gf.duckdns.org";
const TEST_SERVER_ID = "74ac18ef";

const panelUrl = () => String(process.env.ELGAE_PANEL_URL || "").replace(/\/$/, "");
const serverId = () => String(process.env.ELGAE_SERVER_ID || "").trim();
const apiKey = () => String(process.env.ELGAE_API_KEY || "").trim();

function assertIsolatedTarget(): void {
  if (panelUrl() !== TEST_PANEL_URL || serverId() !== TEST_SERVER_ID) {
    throw new Error("Teste bloqueado: as variáveis não apontam para a VPS de teste autorizada.");
  }
  if (!apiKey()) throw new Error("ELGAE_API_KEY não configurada.");
}

async function request(path: string, init: RequestInit = {}): Promise<any> {
  assertIsolatedTarget();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${panelUrl()}/api/client/servers/${serverId()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        Accept: "Application/vnd.pterodactyl.v1+json",
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const detail = typeof data === "string" ? data.slice(0, 220) : data?.errors?.[0]?.detail || "falha na API";
      throw new Error(`Pterodactyl respondeu ${response.status}: ${detail}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function state(): Promise<string> {
  const data = await request("/resources");
  return String(data?.attributes?.current_state || "unknown");
}

async function waitForState(expected: "offline" | "running", timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await state() === expected) return;
    await new Promise(resolve => setTimeout(resolve, 3_000));
  }
  throw new Error(`Servidor não chegou ao estado ${expected} dentro do limite.`);
}

async function startupVariables(): Promise<any[]> {
  const data = await request("/startup");
  return Array.isArray(data?.data) ? data.data.map((item: any) => item?.attributes || item) : [];
}

function findVariable(variables: any[], aliases: string[]): string | null {
  const wanted = new Set(aliases.map(v => v.toUpperCase()));
  const variable = variables.find(v => wanted.has(String(v.env_variable || v.name || "").toUpperCase()));
  return variable ? String(variable.env_variable || variable.name) : null;
}

async function setVariable(key: string, value: string): Promise<void> {
  const response = await request("/startup/variable", {
    method: "PUT",
    body: JSON.stringify({ key, value }),
  });
  const returned = response?.attributes || response?.data?.attributes || response;
  if (String(returned?.server_value ?? "") !== value) {
    throw new Error(`O Pterodactyl não confirmou ${key}=${value}.`);
  }
}

async function configureProceduralMap(seed: number, size: number): Promise<void> {
  const before = await startupVariables();
  const seedKey = findVariable(before, ["WORLD_SEED", "SERVER_SEED", "SEED", "RUST_SEED"]);
  const sizeKey = findVariable(before, ["WORLD_SIZE", "SERVER_WORLD_SIZE", "SERVER_SIZE", "WORLD_SIZE_INT", "RUST_WORLD_SIZE"]);
  const mapUrlKey = findVariable(before, ["MAP_URL", "LEVEL_URL", "LEVELURL", "SERVER_LEVEL_URL", "CUSTOM_MAP_URL"]);

  if (!seedKey || !sizeKey) throw new Error("WORLD_SEED/WORLD_SIZE não encontrados no startup do Pterodactyl.");
  if (mapUrlKey) await setVariable(mapUrlKey, "");
  await setVariable(seedKey, String(seed));
  await setVariable(sizeKey, String(size));

  const after = await startupVariables();
  const seedVar = after.find(v => String(v.env_variable || v.name || "") === seedKey);
  const sizeVar = after.find(v => String(v.env_variable || v.name || "") === sizeKey);
  const savedSeed = String(seedVar?.server_value ?? seedVar?.value ?? "");
  const savedSize = String(sizeVar?.server_value ?? sizeVar?.value ?? "");

  if (savedSeed !== String(seed) || savedSize !== String(size)) {
    throw new Error(`Startup não confirmado pela API: seed=${savedSeed || "?"}, size=${savedSize || "?"}.`);
  }
}

async function listDirectory(directory: string): Promise<any[]> {
  const data = await request(`/files/list?directory=${encodeURIComponent(directory)}`);
  return Array.isArray(data?.data) ? data.data.map((entry: any) => entry?.attributes || entry) : [];
}

type WipeFile = { name: string; directory: string; path: string };

function isMapSave(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".map") || lower.endsWith(".sav") || /\.sav(?:\.\d+|\.bak)?$/.test(lower);
}

async function collectMapFiles(directory: string, depth = 0): Promise<WipeFile[]> {
  if (depth > 4) return [];
  const result: WipeFile[] = [];
  for (const entry of await listDirectory(directory)) {
    const name = String(entry.name || "");
    if (!name || name === "." || name === "..") continue;
    const path = `${directory}/${name}`.replace(/\/+/g, "/");
    if (entry.is_file === false) {
      result.push(...await collectMapFiles(path, depth + 1));
    } else if (isMapSave(name)) {
      result.push({ name, directory, path });
    }
  }
  return result;
}

async function discoverServerDirectories(): Promise<string[]> {
  const entries = await listDirectory("/server").catch(() => []);
  return entries
    .filter((entry: any) => entry.is_file === false && entry.name && entry.name !== "." && entry.name !== "..")
    .map((entry: any) => `/server/${entry.name}`);
}

async function currentMapFiles(): Promise<WipeFile[]> {
  const dirs = await discoverServerDirectories();
  return (await Promise.all(dirs.map(dir => collectMapFiles(dir)))).flat();
}

async function deleteFiles(files: WipeFile[]): Promise<void> {
  const grouped = new Map<string, string[]>();
  for (const file of files) grouped.set(file.directory, [...(grouped.get(file.directory) || []), file.name]);
  for (const [root, names] of grouped) {
    await request("/files/delete", { method: "POST", body: JSON.stringify({ root, files: names }) });
    const remaining = new Set((await listDirectory(root)).map(item => String(item.name)));
    const failed = names.filter(name => remaining.has(name));
    if (failed.length) throw new Error(`Falha ao remover: ${failed.join(", ")}`);
  }
}

async function createBackup(): Promise<string> {
  const created = await request("/backups", {
    method: "POST",
    body: JSON.stringify({ name: `pre-wipe-test-${new Date().toISOString()}`, ignored: "" }),
  });
  const uuid = String(created?.attributes?.uuid || created?.data?.attributes?.uuid || "");
  if (!uuid) throw new Error("O Pterodactyl não retornou o ID do backup.");

  const started = Date.now();
  while (Date.now() - started < 15 * 60_000) {
    const data = await request(`/backups/${uuid}`);
    const backup = data?.attributes || data?.data?.attributes || data;
    if (backup?.completed_at) {
      if (backup.is_successful === false) throw new Error("O backup de teste falhou.");
      return uuid;
    }
    await new Promise(resolve => setTimeout(resolve, 5_000));
  }
  throw new Error("O backup não terminou em 15 minutos; teste cancelado.");
}

async function waitForExpectedMap(seed: number, size: number, timeoutMs = 10 * 60_000): Promise<string> {
  const exact = new RegExp(`(?:^|\\.)${size}(?:\\.1)?\\.${seed}(?:\\.|$)`, "i");
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const maps = (await currentMapFiles()).filter(file => file.name.toLowerCase().endsWith(".map"));
    const correct = maps.find(file => exact.test(file.name));
    if (correct) return correct.path;
    await new Promise(resolve => setTimeout(resolve, 5_000));
  }
  const maps = (await currentMapFiles()).filter(file => file.name.toLowerCase().endsWith(".map")).map(file => file.name);
  throw new Error(`Mapa esperado size ${size} seed ${seed} não apareceu. Encontrados: ${maps.join(", ") || "nenhum"}.`);
}

export async function runIsolatedVpsWipeTest(seed: number, size: number): Promise<VpsWipeTestResult> {
  assertIsolatedTarget();
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) throw new Error("Seed inválida.");
  if (!Number.isInteger(size) || size < 1000 || size > 6000) throw new Error("Size inválido.");

  const files = await currentMapFiles();
  if (!files.some(file => file.name.toLowerCase().endsWith(".map"))) {
    throw new Error("Nenhum arquivo .map atual encontrado; teste cancelado por segurança.");
  }

  await request("/power", { method: "POST", body: JSON.stringify({ signal: "stop" }) });
  await waitForState("offline", 120_000);

  const backupId = await createBackup();
  await configureProceduralMap(seed, size);
  await deleteFiles(files);
  await request("/power", { method: "POST", body: JSON.stringify({ signal: "start" }) });

  try {
    await waitForState("running", 10 * 60_000);
  } catch (error) {
    const current = await state().catch(() => "unknown");
    throw new Error(`O comando START foi enviado, mas o Pterodactyl não confirmou running no tempo esperado. Estado atual: ${current}. O bot NÃO enviou STOP.`);
  }

  const mapFile = await waitForExpectedMap(seed, size);
  return { filesDeleted: files.length, seed, size, mapFile, backupId };
}
