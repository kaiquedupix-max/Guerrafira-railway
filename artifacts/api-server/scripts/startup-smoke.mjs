import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
const child = spawn(process.execPath, ["artifacts/api-server/dist/index.mjs"], {
 env: { ...process.env, PORT: "3210", NODE_ENV: process.env.NODE_ENV || "production", DISCORD_BOT_TOKEN: "", DUO_STATUS_BOT_TOKEN: "", TRIO_STATUS_BOT_TOKEN: "", TRIO_DISCORD_BOT_TOKEN: "" },
 stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
let exited = false;
child.once("exit", () => { exited = true; });
try {
 let healthy = false;
 for (let attempt = 0; attempt < 80; attempt++) {
   if (exited) throw new Error("Built application exited before HTTP became ready");
   try {
     const response = await fetch("http://127.0.0.1:3210/status", { signal: AbortSignal.timeout(1000) });
     if (response.ok && (await response.json()).status === "ok") { healthy = true; break; }
   } catch {}
   await delay(250);
 }
 if (!healthy) throw new Error("Built application did not become ready in 20 seconds");
 await delay(2000);
 if (exited) throw new Error("Built application crashed after startup");
 console.log("Built application startup and HTTP health passed");
} finally {
 child.kill("SIGTERM");
}
