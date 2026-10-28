import { ActionError } from "./actionError.js";

export async function confirmRustBan(steamId: string, run: (command: string) => Promise<string>): Promise<void> {
  if (!/^7656119\d{10}$/.test(steamId)) throw new ActionError("SteamID inválido.");
  const list = await run("banlist");
  if (!new RegExp(`\\b${steamId}\\b`).test(list)) throw new ActionError("O jogador não apareceu na lista de banimentos do Rust. A confirmação será repetida.", 503);
  await run("server.writecfg");
}
