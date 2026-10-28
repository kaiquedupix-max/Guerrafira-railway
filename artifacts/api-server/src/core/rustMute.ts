import { ActionError } from "./actionError.js";

/** A transport reply alone does not prove that Rust applied a chat mute. */
export async function setRustChatMute(steamId: string, expiresAt: Date | null, run: (command: string) => Promise<string | null>): Promise<void> {
  if (!/^7656119\d{10}$/.test(steamId)) throw new ActionError("SteamID inválido.");
  const muted = expiresAt !== null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) throw new ActionError("Prazo de mute inválido.");
  const command = muted ? `gf.guard.mute ${steamId} ${Math.ceil(expiresAt!.getTime() / 1000)}` : `gf.guard.unmute ${steamId}`;
  const result = await run(command);
  const expected = `${muted ? "GF_GUARD_MUTED" : "GF_GUARD_UNMUTED"} ${steamId}`;
  if (result?.trim() !== expected) throw new ActionError("O Rust não confirmou a alteração do mute. Verifique o plugin GuerraFriaModeration e tente novamente.", 503);
}
