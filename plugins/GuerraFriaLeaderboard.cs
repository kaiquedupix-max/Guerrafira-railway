using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Oxide.Core.Libraries;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("GuerraFriaLeaderboard", "Maciota", "2.0.2")]
    [Description("Leaderboard Guerra Fria enviado ao bot por webhook, sem poluir o console.")]
    public class GuerraFriaLeaderboard : RustPlugin
    {
        private PluginConfig config;
        private readonly List<LeaderboardEvent> queue = new List<LeaderboardEvent>();
        private readonly Dictionary<string, int> observedScrapStacks = new Dictionary<string, int>();
        private bool sending;
        private DateTime lastQueueWarning = DateTime.MinValue;

        private class PluginConfig
        {
            [JsonProperty("Webhook URL")]
            public string WebhookUrl = "https://guerrafria.up.railway.app/api/leaderboard/events";
            [JsonProperty("Webhook Secret")]
            public string WebhookSecret = "COLOQUE_A_MESMA_CHAVE_DO_RAILWAY";
            [JsonProperty("Intervalo de envio em segundos")]
            public float BatchSeconds = 5f;
            [JsonProperty("Eventos por lote")]
            public int MaxBatchSize = 100;
            [JsonProperty("Máximo de eventos aguardando")]
            public int MaxQueueSize = 5000;
        }

        private class LeaderboardEvent
        {
            public string event_id;
            public string @event;
            public string attacker;
            public string attacker_steamid;
            public string victim;
            public string victim_steamid;
            public bool headshot;
            public string weapon;
            public string bone;
            public float distance;
            public long timestamp;
            public string steamid;
            public string player;
            public string item;
            public int amount;
        }

        protected override void LoadDefaultConfig() { config = new PluginConfig(); SaveConfig(); }
        protected override void LoadConfig()
        {
            base.LoadConfig();
            try { config = Config.ReadObject<PluginConfig>() ?? new PluginConfig(); }
            catch { PrintError("Configuração inválida; uma configuração nova foi criada."); config = new PluginConfig(); }
            config.BatchSeconds = Mathf.Clamp(config.BatchSeconds, 2f, 60f);
            config.MaxBatchSize = Mathf.Clamp(config.MaxBatchSize, 10, 250);
            config.MaxQueueSize = Mathf.Clamp(config.MaxQueueSize, 500, 20000);
            SaveConfig();
        }
        protected override void SaveConfig() { Config.WriteObject(config, true); }

        private void Init() { timer.Every(config.BatchSeconds, FlushQueue); }
        private void OnServerInitialized() { Enqueue(new LeaderboardEvent { @event = "ready" }); }
        private void Unload() { FlushQueue(); }

        private bool IsRealPlayer(BasePlayer player)
        {
            if (player == null || player.userID == 0) return false;
            var id = player.UserIDString;
            return !string.IsNullOrEmpty(id) && id.StartsWith("7656119") && id.Length == 17;
        }

        private string GetWeaponName(HitInfo info)
        {
            if (info == null) return "unknown";
            try { if (info.WeaponPrefab != null && !string.IsNullOrEmpty(info.WeaponPrefab.ShortPrefabName)) return info.WeaponPrefab.ShortPrefabName; } catch { }
            try { if (info.Weapon != null && !string.IsNullOrEmpty(info.Weapon.ShortPrefabName)) return info.Weapon.ShortPrefabName; } catch { }
            return "unknown";
        }

        private string GetBoneName(HitInfo info)
        {
            try { var name = StringPool.Get(info.HitBone); return string.IsNullOrEmpty(name) ? "unknown" : name; }
            catch { return "unknown"; }
        }

        private bool IsBowWeapon(string weapon)
        {
            if (string.IsNullOrEmpty(weapon)) return false;
            weapon = weapon.ToLowerInvariant();
            return weapon.Contains("bow") || weapon.Contains("crossbow");
        }

        private void Enqueue(LeaderboardEvent payload)
        {
            payload.event_id = Guid.NewGuid().ToString("N");
            payload.timestamp = payload.timestamp > 0 ? payload.timestamp : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (queue.Count >= config.MaxQueueSize)
            {
                queue.RemoveAt(0);
                if ((DateTime.UtcNow - lastQueueWarning).TotalMinutes >= 5) { PrintWarning("Fila do webhook cheia; o evento mais antigo foi descartado."); lastQueueWarning = DateTime.UtcNow; }
            }
            queue.Add(payload);
        }

        private void FlushQueue()
        {
            if (sending || queue.Count == 0) return;
            if (string.IsNullOrWhiteSpace(config.WebhookUrl) || string.IsNullOrWhiteSpace(config.WebhookSecret) || config.WebhookSecret.Contains("COLOQUE_")) return;
            var count = Math.Min(queue.Count, config.MaxBatchSize);
            var batch = queue.GetRange(0, count);
            var body = JsonConvert.SerializeObject(new { events = batch }, Formatting.None, new JsonSerializerSettings { NullValueHandling = NullValueHandling.Ignore });
            var headers = new Dictionary<string, string> { ["Content-Type"] = "application/json", ["x-gf-leaderboard-secret"] = config.WebhookSecret };
            sending = true;
            webrequest.Enqueue(config.WebhookUrl, body, (code, response) =>
            {
                sending = false;
                if (code >= 200 && code < 300) { if (queue.Count >= count) queue.RemoveRange(0, count); }
                else if ((DateTime.UtcNow - lastQueueWarning).TotalMinutes >= 5) { PrintWarning("Webhook indisponível (HTTP " + code + "); os eventos serão reenviados."); lastQueueWarning = DateTime.UtcNow; }
            }, this, RequestMethod.POST, headers, 15f);
        }

        private void EmitRaidUse(BasePlayer player, string item)
        {
            if (!IsRealPlayer(player)) return;
            Enqueue(new LeaderboardEvent { @event = "raid_use", steamid = player.UserIDString, player = player.displayName ?? "Unknown", item = item, amount = 1 });
        }

        private void OnRocketLaunched(BasePlayer player, BaseEntity entity)
        {
            if (!IsRealPlayer(player)) return;
            try { var active = player.GetActiveItem(); if (active == null || active.info == null || active.info.shortname != "rocket.launcher") return; }
            catch { return; }
            EmitRaidUse(player, "rocket");
        }

        private void OnExplosiveThrown(BasePlayer player, BaseEntity entity, ThrownWeapon item)
        {
            if (!IsRealPlayer(player) || entity == null) return;
            var prefab = (entity.ShortPrefabName ?? string.Empty).ToLowerInvariant();
            if (prefab.Contains("explosive.timed") || prefab.Contains("timedexplosive") || prefab.Contains("timed.explosive")) EmitRaidUse(player, "c4");
        }

        private void OnEntityTakeDamage(BaseCombatEntity entity, HitInfo info)
        {
            var victim = entity as BasePlayer; if (victim == null || info == null) return;
            var attacker = info.InitiatorPlayer; if (!IsRealPlayer(attacker) || !IsRealPlayer(victim) || attacker.userID == victim.userID) return;
            var weapon = GetWeaponName(info); if (!IsBowWeapon(weapon)) return;
            Enqueue(new LeaderboardEvent { @event = "arrow_hit", attacker = attacker.displayName ?? "Unknown", attacker_steamid = attacker.UserIDString, victim = victim.displayName ?? "Unknown", victim_steamid = victim.UserIDString, headshot = info.isHeadshot, weapon = weapon, bone = GetBoneName(info), distance = (float)Math.Round(Vector3.Distance(attacker.transform.position, victim.transform.position), 1) });
        }

        private void OnEntityDeath(BaseCombatEntity entity, HitInfo info)
        {
            var victim = entity as BasePlayer; if (victim == null || info == null) return;
            var attacker = info.InitiatorPlayer; if (!IsRealPlayer(attacker) || !IsRealPlayer(victim) || attacker.userID == victim.userID) return;
            Enqueue(new LeaderboardEvent { @event = "kill", attacker = attacker.displayName ?? "Unknown", attacker_steamid = attacker.UserIDString, victim = victim.displayName ?? "Unknown", victim_steamid = victim.UserIDString, headshot = info.isHeadshot, weapon = GetWeaponName(info), bone = GetBoneName(info), distance = (float)Math.Round(Vector3.Distance(attacker.transform.position, victim.transform.position), 1) });
        }

        private void OnDispenserGathered(ResourceDispenser dispenser, BasePlayer player, Item item) { TrackGather(player, item); }
        private void OnDispenserBonusReceived(ResourceDispenser dispenser, BasePlayer player, Item item) { TrackGather(player, item); }
        private void OnCollectiblePickedup(CollectibleEntity collectible, BasePlayer player, Item item) { TrackGather(player, item); }
        private void TrackGather(BasePlayer player, Item item)
        {
            if (!IsRealPlayer(player) || item == null || item.amount <= 0 || item.info == null) return;
            Enqueue(new LeaderboardEvent { @event = "gather", steamid = player.UserIDString, player = player.displayName ?? "Unknown", item = item.info.shortname ?? "unknown", amount = item.amount });
        }

        private void OnItemAddedToContainer(ItemContainer container, Item item)
        {
            if (item == null || item.info == null || item.info.shortname != "scrap" || item.amount <= 0) return;
            var player = item.GetOwnerPlayer(); if (!IsRealPlayer(player)) return;
            var key = item.uid.ToString(); int previous; observedScrapStacks.TryGetValue(key, out previous);
            if (item.amount <= previous) return;
            var gained = item.amount - previous; observedScrapStacks[key] = item.amount;
            Enqueue(new LeaderboardEvent { @event = "gather", steamid = player.UserIDString, player = player.displayName ?? "Unknown", item = "scrap", amount = gained });
        }

        private void OnItemCraftFinished(ItemCraftTask task, Item item, ItemCrafter crafter)
        {
            if (task == null || item == null || item.info == null || crafter == null) return;
            var player = crafter.owner; if (!IsRealPlayer(player)) return;
            var shortname = item.info.shortname ?? string.Empty; if (!IsTrackedCraft(shortname)) return;
            Enqueue(new LeaderboardEvent { @event = "craft", steamid = player.UserIDString, player = player.displayName ?? "Unknown", item = shortname, amount = Math.Max(item.amount, 1) });
        }

        private bool IsTrackedCraft(string shortname)
        {
            if (shortname == "gunpowder") return true;
            switch (shortname) { case "explosives": case "explosive.timed": case "grenade.f1": case "grenade.beancan": case "ammo.rocket.basic": case "ammo.rocket.hv": case "ammo.rocket.fire": case "ammo.rifle.explosive": case "surveycharge": return true; default: return false; }
        }

        [ConsoleCommand("gflb.status")]
        private void StatusCommand(ConsoleSystem.Arg arg)
        {
            if (arg == null) return;
            arg.ReplyWith("GuerraFriaLeaderboard v2.0.2 ONLINE | webhook=" + (!string.IsNullOrWhiteSpace(config.WebhookSecret) && !config.WebhookSecret.Contains("COLOQUE_") ? "configurado" : "pendente") + " | fila=" + queue.Count + " | enviando=" + sending);
        }
    }
}
