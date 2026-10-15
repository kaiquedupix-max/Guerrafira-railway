import { warmIpModeration } from "./core/ipModeration.js";
import { ensurePlayerDirectory, startPlayerDirectory } from "./core/playerDirectory.js";
import { ensureDatabaseSchema } from "@workspace/db";
import app from "./appSafe";
import { logger } from "./lib/logger";
import { startBot } from "./bot/index";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startApplication(): Promise<void> {
  logger.info("Preparing database schema before starting the application");
  await ensureDatabaseSchema();
  await ensurePlayerDirectory();
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, () => resolve());
    server.once("error", reject);
  });
  logger.info({ port }, "Server listening");
  startPlayerDirectory();
  warmIpModeration();
  startBot().catch(err => logger.error({ err }, "Discord bot failed to start"));
}

startApplication().catch(err => {
  logger.fatal({ err }, "Application startup failed");
  process.exit(1);
});
