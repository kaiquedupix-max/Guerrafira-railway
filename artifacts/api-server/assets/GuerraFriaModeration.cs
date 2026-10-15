using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using Newtonsoft.Json;

namespace Oxide.Plugins
{
    [Info("GuerraFriaModeration", "Mac1otaDev", "1.0.0")]
    [Description("Bloqueio de Steam/IP e consulta confiavel de times para Duo e Trio.")]
    public class GuerraFriaModeration : RustPlugin
    {
        private class Rule
        {
            public string SteamId;
            public string Reason;
            public long ExpiresAt;
            public List<string> Ips = new List<string>();
            public bool Managed;
        }
        private class Payload
        {
            public string SteamId;
            public string Reason;
            public long ExpiresAt;
            public List<string> Ips;
        }
        private class Saved
        {
            public Dictionary<string, string> Players = new Dictionary<string, string>();
            public Dictionary<string, Rule> Rules = new Dictionary<string, Rule>();
        }
        private Saved saved;
        private bool dirty;
        private static long Now() { return DateTimeOffset.UtcNow.ToUnixTimeSeconds(); }
        private static string Ip(string address)
        {
            if (string.IsNullOrWhiteSpace(address)) return null;
            address = address.Trim();
            if (address.StartsWith("[")) { var end = address.IndexOf(']'); if (end > 0) address = address.Substring(1, end - 1); }
            IPAddress parsed;
            if (!IPAddress.TryParse(address, out parsed))
            {
                var colon = address.LastIndexOf(':');
                if (colon <= 0 || !IPAddress.TryParse(address.Substring(0, colon), out parsed)) return null;
            }
            if (parsed.IsIPv4MappedToIPv6) parsed = parsed.MapToIPv4();
            if (parsed.Equals(IPAddress.Any) || parsed.Equals(IPAddress.IPv6Any)) return null;
            return parsed.ToString();
        }
        private static bool ValidId(string id) { ulong n; return id != null && id.Length == 17 && id.StartsWith("7656119") && ulong.TryParse(id, out n); }
        private static bool Active(Rule rule) { return rule != null && (rule.ExpiresAt <= 0 || rule.ExpiresAt > Now()); }
        private bool Allowed(ConsoleSystem.Arg arg)
        {
            if (arg.Connection == null || arg.Connection.authLevel >= 2) return true;
            arg.ReplyWith("GF_GUARD_DENIED"); return false;
        }
        private void Init()
        {
            try { saved = InterfaceData(); }
            catch (Exception error) { PrintError("Nao foi possivel ler os bloqueios: " + error.Message); throw; }
            saved.Players = saved.Players ?? new Dictionary<string, string>();
            saved.Rules = saved.Rules ?? new Dictionary<string, Rule>();
            timer.Every(30f, () => { Prune(); Save(); });
        }
        private Saved InterfaceData()
        {
            return Oxide.Core.Interface.Oxide.DataFileSystem.ReadObject<Saved>(Name) ?? new Saved();
        }
        private void Save() { if (!dirty) return; Oxide.Core.Interface.Oxide.DataFileSystem.WriteObject(Name, saved); dirty = false; }
        private void OnServerSave() { Save(); }
        private void Unload() { Save(); }
        private void Prune()
        {
            foreach (var id in saved.Rules.Where(pair => !Active(pair.Value)).Select(pair => pair.Key).ToList()) { saved.Rules.Remove(id); dirty = true; }
        }
        private string Remember(Network.Connection connection)
        {
            if (connection == null) return null;
            var ip = Ip(connection.ipaddress); var id = connection.userid.ToString();
            if (ip != null && ValidId(id)) { saved.Players[id] = ip; dirty = true; }
            return ip;
        }
        private void OnServerInitialized()
        {
            foreach (var player in BasePlayer.activePlayerList) Remember(player.net == null ? null : player.net.connection);
        }
        private object CanClientLogin(Network.Connection connection)
        {
            var ip = Remember(connection); if (ip == null) return null;
            var id = connection.userid.ToString();
            foreach (var rule in saved.Rules.Values)
            {
                if (!Active(rule) || (rule.SteamId != id && !rule.Ips.Contains(ip))) continue;
                Puts("[GF_IP_BLOCK] " + JsonConvert.SerializeObject(new { steamId = id, rootSteamId = rule.SteamId }));
                return "Acesso bloqueado: " + rule.Reason + " | Recurso: discord.gg/guerrafria";
            }
            return null;
        }
        [ConsoleCommand("gf.guard.status")]
        private void Status(ConsoleSystem.Arg arg) { if (Allowed(arg)) arg.ReplyWith("GF_GUARD_READY_1"); }
        [ConsoleCommand("gf.guard.player")]
        private void PlayerInfo(ConsoleSystem.Arg arg)
        {
            if (!Allowed(arg)) return;
            var id = arg.GetString(0, ""); if (!ValidId(id)) { arg.ReplyWith("GF_GUARD_INVALID_ID"); return; }
            var player = BasePlayer.FindByID(ulong.Parse(id));
            var ip = player != null && player.net != null ? Remember(player.net.connection) : null;
            if (ip == null) saved.Players.TryGetValue(id, out ip);
            arg.ReplyWith(JsonConvert.SerializeObject(new { steamId = id, ip = ip }));
        }
        [ConsoleCommand("gf.guard.team")]
        private void TeamInfo(ConsoleSystem.Arg arg)
        {
            if (!Allowed(arg)) return;
            var id = arg.GetString(0, ""); if (!ValidId(id)) { arg.ReplyWith("GF_GUARD_INVALID_ID"); return; }
            var team = RelationshipManager.ServerInstance.FindPlayersTeam(ulong.Parse(id));
            var rows = new List<object>();
            if (team != null) foreach (var member in team.members)
            {
                var player = BasePlayer.FindByID(member) ?? BasePlayer.FindSleeping(member);
                rows.Add(new { SteamID = member.ToString(), DisplayName = player == null ? member.ToString() : player.displayName, Online = player != null && player.IsConnected });
            }
            arg.ReplyWith(JsonConvert.SerializeObject(rows));
        }
        [ConsoleCommand("gf.guard.ban")]
        private void Ban(ConsoleSystem.Arg arg)
        {
            if (!Allowed(arg)) return;
            Payload input;
            try { input = JsonConvert.DeserializeObject<Payload>(Encoding.UTF8.GetString(Convert.FromBase64String(arg.GetString(0, "")))); }
            catch { arg.ReplyWith("GF_GUARD_INVALID_PAYLOAD"); return; }
            if (input == null || !ValidId(input.SteamId) || string.IsNullOrWhiteSpace(input.Reason)) { arg.ReplyWith("GF_GUARD_INVALID_PAYLOAD"); return; }
            var ips = new HashSet<string>();
            Rule previous;
            if (saved.Rules.TryGetValue(input.SteamId, out previous) && Active(previous))
                foreach (var address in previous.Ips ?? new List<string>()) { var ip = Ip(address); if (ip != null) ips.Add(ip); }
            foreach (var address in input.Ips ?? new List<string>()) { var ip = Ip(address); if (ip != null) ips.Add(ip); }
            string known; if (saved.Players.TryGetValue(input.SteamId, out known)) { var ip = Ip(known); if (ip != null) ips.Add(ip); }
            var current = BasePlayer.FindByID(ulong.Parse(input.SteamId));
            var live = current != null && current.net != null ? Remember(current.net.connection) : null;
            if (live != null) ips.Add(live);
            if (input.ExpiresAt > 0 && input.ExpiresAt <= Now()) { saved.Rules.Remove(input.SteamId); dirty = true; Save(); arg.ReplyWith("GF_GUARD_EXPIRED"); return; }
            saved.Rules[input.SteamId] = new Rule { SteamId = input.SteamId, Reason = input.Reason, ExpiresAt = input.ExpiresAt, Ips = ips.ToList(), Managed = true };
            dirty = true; Save();
            foreach (var player in BasePlayer.activePlayerList.ToList())
            {
                var ip = player.net != null ? Ip(player.net.connection == null ? null : player.net.connection.ipaddress) : null;
                if (player.UserIDString == input.SteamId || (ip != null && ips.Contains(ip))) player.Kick("Acesso bloqueado: " + input.Reason);
            }
            arg.ReplyWith("GF_GUARD_BANNED " + ips.Count);
        }
        [ConsoleCommand("gf.guard.unban")]
        private void Unban(ConsoleSystem.Arg arg)
        {
            if (!Allowed(arg)) return;
            var id = arg.GetString(0, ""); if (!ValidId(id)) { arg.ReplyWith("GF_GUARD_INVALID_ID"); return; }
            saved.Rules.Remove(id); dirty = true; Save(); arg.ReplyWith("GF_GUARD_UNBANNED");
        }
        private void OnPlayerBanned(string playerName, ulong steamId, string address, string reason, long expiry)
        {
            var id = steamId.ToString(); Rule current;
            if (saved.Rules.TryGetValue(id, out current) && current.Managed) return;
            var ip = Ip(address); if (ip == null) saved.Players.TryGetValue(id, out ip);
            saved.Rules[id] = new Rule { SteamId = id, Reason = reason, ExpiresAt = expiry, Ips = ip == null ? new List<string>() : new List<string> { ip } };
            dirty = true; Save();
        }
        private void OnPlayerUnbanned(string playerName, ulong steamId, string address)
        {
            if (saved.Rules.Remove(steamId.ToString())) { dirty = true; Save(); }
        }
    }
}
