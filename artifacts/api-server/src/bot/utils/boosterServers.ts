import { executeServerRcon } from "./serverRcon.js";
import type { GuerraFriaServerId } from "../../core/servers.js";

export function boosterCommand(server: GuerraFriaServerId, steamId: string, active: boolean): string {
  if (!/^\d{17}$/.test(steamId)) throw new Error("SteamID64 inválido.");
  const key = active ? "BOOSTER_GAME_ADD_CMD" : "BOOSTER_GAME_REMOVE_CMD";
  const template = (server === "trio" ? process.env[`TRIO_${key}`] : process.env[key])?.trim()
    || `c.usergroup ${active ? "add" : "remove"} {steamid} bs`;
  return template.replace(/^oxide\./i, "c.").replace(/\{steam[Ii][Dd]\}/g, steamId);
}

/** Apply independently: a failed Trio connection must not prevent the Duo command. */
export async function syncBoosterServers(steamId: string, active: boolean): Promise<string | null> {
  const results = await Promise.all((["solo-duo", "trio"] as const).map(async server => {
    const result = await executeServerRcon(server, boosterCommand(server, steamId, active)).catch(() => null);
    return result !== null && !/unknown command|error:|failed|exception/i.test(result);
  }));
  return results.every(Boolean) ? "Booster sincronizado no Solo/Duo e Trio" : null;
}
