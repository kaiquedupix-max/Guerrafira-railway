import { readHostTextFile, writeHostTextFile } from "../../core/hostConsole.js";
import { logger } from "../../lib/logger.js";

const PLUGIN_DIRECTORY = "/oxide/plugins";
const PLUGIN_NAME = "GuerraFriaAnnouncements.cs";

const PLUGIN_SOURCE = `using System;
using System.Text;

namespace Oxide.Plugins
{
    [Info("GuerraFriaAnnouncements", "Mac1otaDev", "1.0.0")]
    [Description("Envia avisos do Guerra Fria no chat sem o prefixo vanilla [SERVER].")]
    public class GuerraFriaAnnouncements : RustPlugin
    {
        [ConsoleCommand("guerrafria.announce")]
        private void GuerraFriaAnnounce(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && arg.Connection.authLevel < 2)
            {
                arg.ReplyWith("GFANNOUNCE_DENIED");
                return;
            }

            var payload = arg.GetString(0, string.Empty);
            if (string.IsNullOrWhiteSpace(payload))
            {
                arg.ReplyWith("GFANNOUNCE_EMPTY");
                return;
            }

            string message;
            try
            {
                message = Encoding.UTF8.GetString(Convert.FromBase64String(payload));
            }
            catch
            {
                arg.ReplyWith("GFANNOUNCE_INVALID");
                return;
            }

            foreach (var player in BasePlayer.activePlayerList)
            {
                player.SendConsoleCommand("chat.add", 2, 0, message);
            }

            arg.ReplyWith("GFANNOUNCE_OK");
        }
    }
}
`;

let installPromise: Promise<void> | null = null;

export function ensureGameAnnouncementPlugin(): Promise<void> {
  if (installPromise) return installPromise;

  installPromise = (async () => {
    try {
      const current = await readHostTextFile(PLUGIN_DIRECTORY, PLUGIN_NAME).catch(() => null);
      if (current?.content === PLUGIN_SOURCE) {
        logger.info("Guerra Fria announcement plugin already installed");
        return;
      }

      await writeHostTextFile(PLUGIN_DIRECTORY, PLUGIN_NAME, PLUGIN_SOURCE);
      logger.info({ path: `${PLUGIN_DIRECTORY}/${PLUGIN_NAME}` }, "Guerra Fria announcement plugin installed/updated");

      // Oxide recompila automaticamente quando o .cs é criado/alterado.
      await new Promise(resolve => setTimeout(resolve, 4_000));
    } catch (err) {
      logger.error({ err }, "Failed to install Guerra Fria announcement plugin; vanilla server chat will be used as fallback");
    }
  })();

  return installPromise;
}
