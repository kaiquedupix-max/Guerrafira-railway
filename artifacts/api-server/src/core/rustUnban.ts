import { ActionError } from "./actionError.js";

const failure = /unknown command|command not found|permission denied|not allowed|access denied|^\s*(?:error|exception)\b/im;
/** Check the Rust ban list after unban before treating the operation as successful. */
export async function removeRustBan(steamId: string, run: (command: string) => Promise<string>): Promise<void> {
  if (!/^7656119\d{10}$/.test(steamId)) throw new ActionError("SteamID inválido.");
  const removed = await run(`unban ${steamId}`);
  if (failure.test(removed)) throw new ActionError("O servidor recusou o desbanimento. Verifique os registros RCON.", 503);
  const banned = await run("banlist");
  if (failure.test(banned)) throw new ActionError("Não foi possível verificar a lista de banimentos do servidor.", 503);
  if (new RegExp(`\\b${steamId}\\b`).test(banned)) throw new ActionError("O jogador continua banido no servidor. O desbanimento não foi confirmado.", 503);
  const saved = await run("server.writecfg");
  if (failure.test(saved)) throw new ActionError("O bloqueio foi removido, mas o servidor não confirmou o salvamento. Verifique antes de reiniciar.", 503);
}
