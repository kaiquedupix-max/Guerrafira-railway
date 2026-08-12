using System;
using Newtonsoft.Json;
using Oxide.Core;

namespace Oxide.Plugins
{
    [Info("GuerraFriaLeaderboard", "OpenAI", "1.0.3")]
    [Description("Emite eventos de kills, mortes, headshots, farm e craft para o leaderboard Guerra Fria via RCON/console.")]
    public class GuerraFriaLeaderboard : RustPlugin
    {
        private const string Prefix = "[GF_LEADERBOARD]";

        private class LeaderboardEvent
        {
            public string @event;
            public string attacker;
            public string attacker_steamid;
            public string victim;
            public string victim_steamid;
            public bool headshot;
            public string steamid;
            public string player;
            public string item;
            public int amount;
        }

        private void Init()
        {
            Puts("GuerraFriaLeaderboard carregado. Eventos do leaderboard serão enviados pelo console/RCON.");
        }

        private void OnServerInitialized()
        {
            Emit(new LeaderboardEvent { @event = "ready" });
        }

        private bool IsRealPlayer(BasePlayer player)
        {
            if (player == null || player.userID == 0)
                return false;

            var steamId = player.UserIDString;
            return !string.IsNullOrEmpty(steamId) && steamId.StartsWith("7656119");
        }

        private void OnEntityDeath(BaseCombatEntity entity, HitInfo info)
        {
            var victim = entity as BasePlayer;
            if (victim == null || info == null)
                return;

            var attacker = info.InitiatorPlayer;
            if (!IsRealPlayer(attacker) || !IsRealPlayer(victim))
                return;

            if (attacker.userID == victim.userID)
                return;

            Emit(new LeaderboardEvent
            {
                @event = "kill",
                attacker = attacker.displayName ?? "Unknown",
                attacker_steamid = attacker.UserIDString,
                victim = victim.displayName ?? "Unknown",
                victim_steamid = victim.UserIDString,
                headshot = info.isHeadshot
            });
        }

        private void OnDispenserGathered(ResourceDispenser dispenser, BasePlayer player, Item item)
        {
            TrackGather(player, item);
        }

        private void OnDispenserBonusReceived(ResourceDispenser dispenser, BasePlayer player, Item item)
        {
            TrackGather(player, item);
        }

        private void OnCollectiblePickedup(CollectibleEntity collectible, BasePlayer player, Item item)
        {
            TrackGather(player, item);
        }

        private void TrackGather(BasePlayer player, Item item)
        {
            if (!IsRealPlayer(player) || item == null || item.amount <= 0)
                return;

            Emit(new LeaderboardEvent
            {
                @event = "gather",
                steamid = player.UserIDString,
                player = player.displayName ?? "Unknown",
                item = item.info != null ? item.info.shortname : "unknown",
                amount = item.amount
            });
        }

        private void OnItemCraftFinished(ItemCraftTask task, Item item, ItemCrafter crafter)
        {
            if (task == null || item == null || item.info == null || crafter == null)
                return;

            var player = crafter.owner;
            if (!IsRealPlayer(player))
                return;

            var shortname = item.info.shortname ?? string.Empty;
            if (!IsExplosive(shortname))
                return;

            Emit(new LeaderboardEvent
            {
                @event = "craft",
                steamid = player.UserIDString,
                player = player.displayName ?? "Unknown",
                item = shortname,
                amount = Math.Max(item.amount, 1)
            });
        }

        private bool IsExplosive(string shortname)
        {
            switch (shortname)
            {
                case "explosives":
                case "explosive.timed":
                case "grenade.f1":
                case "grenade.beancan":
                case "ammo.rocket.basic":
                case "ammo.rocket.hv":
                case "ammo.rocket.fire":
                case "ammo.rifle.explosive":
                case "surveycharge":
                    return true;
                default:
                    return false;
            }
        }

        private void Emit(LeaderboardEvent payload)
        {
            try
            {
                var json = JsonConvert.SerializeObject(payload, Formatting.None,
                    new JsonSerializerSettings { NullValueHandling = NullValueHandling.Ignore });
                Puts($"{Prefix} {json}");
            }
            catch (Exception ex)
            {
                PrintError($"Falha ao emitir evento do leaderboard: {ex.Message}");
            }
        }

        [ConsoleCommand("gflb.status")]
        private void StatusCommand(ConsoleSystem.Arg arg)
        {
            if (arg == null)
                return;

            arg.ReplyWith("GuerraFriaLeaderboard: ONLINE | kills/deaths/headshots/farm/craft ativos");
        }
    }
}
