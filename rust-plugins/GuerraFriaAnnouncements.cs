using System;
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
