import { GUERRA_FRIA_SERVERS, type GuerraFriaServerId } from "./servers.js";
export function serverConnectPage(server:GuerraFriaServerId):string {
 const config=GUERRA_FRIA_SERVERS[server];
 const host=process.env[config.hostEnv]||(server==="solo-duo"?"jogar.guerrafriarust.com.br":"");
 const port=Number(process.env[config.portEnv]||28015);
 if(!host||!(/^[a-z0-9.-]+$/i.test(host)||/^\[[a-f0-9:]+\]$/i.test(host))||!Number.isInteger(port)||port<1||port>65535)throw new Error("Endereço de conexão do servidor não configurado.");
 const address=`${host}:${port}`;
 return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Conectar • ${config.name}</title><body style="background:#0b0d10;color:#eee;font:18px system-ui;text-align:center;padding:10vh 24px"><h1>${config.name}</h1><p>Abra o Rust para conectar ao servidor.</p><p><a style="display:inline-block;background:#23995c;color:white;padding:16px 24px;border-radius:10px;text-decoration:none" href="steam://connect/${address}">🎮 Conectar ao servidor</a></p><p>Ou cole no console do Rust (F1):</p><code>client.connect ${address}</code></body></html>`;
}
