import { executePreparedProceduralWipe } from "./hostWipe.js";

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

/**
 * O /wipe test usa exatamente o MESMO executor procedural do wipe manual
 * e do wipe automático da votação. Assim, se este teste completar, o fluxo
 * destrutivo (stop -> backup -> seed/size -> delete -> start -> validação)
 * é o mesmo usado no wipe oficial.
 */
export async function runIsolatedVpsWipeTest(seed: number, size: number): Promise<VpsWipeTestResult> {
  assertIsolatedTarget();

  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)
    throw new Error("Seed inválida.");
  if (!Number.isInteger(size) || size < 1000 || size > 6000)
    throw new Error("Size inválido.");

  const result = await executePreparedProceduralWipe(
    "map",
    seed,
    size,
    { id: "WIPE_TEST", name: "Wipe test - fluxo oficial" },
    false,
  );

  return {
    filesDeleted: result.filesDeleted,
    seed: result.seed,
    size: result.size,
    mapFile: result.mapFile,
    // O executor oficial audita o backup internamente; o comando de teste
    // não precisa manter um segundo sistema de backup separado.
    backupId: "fluxo-oficial",
  };
}
