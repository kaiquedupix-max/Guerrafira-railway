using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Linq;
using Oxide.Core;
using Oxide.Core.Libraries;
using UnityEngine;
using UnityEngine.Networking;
using Newtonsoft.Json.Linq;

namespace Oxide.Plugins
{
    [Info("GuerraFriaSeasonV117", "Guerra Fria", "1.0.11")]
    [Description("Season mensal premiada: PvP+Raid, Farm, Construção, Eventos, anti-abuso, ledger e MMR balanceado.")]
    public class GuerraFriaSeasonV117 : RustPlugin
    {
        // Season transport is intentionally isolated from the legacy leaderboard API.
        // These are the ONLY HTTP endpoints used by the Season pipeline.
        private const string SeasonEventsEndpoint = "https://www.guerrafriarust.com.br/api/season/events";
        private const string SeasonSnapshotEndpoint = "https://www.guerrafriarust.com.br/api/season/snapshot";
        private const string SeasonBootstrapEndpoint = "https://www.guerrafriarust.com.br/api/season/bootstrap";
        private const string SeasonPingEndpoint = "https://www.guerrafriarust.com.br/api/season/ping";
        private PluginConfig _config;
        private StoredData _data;

        private readonly Dictionary<ulong, RuntimePlayerState> _runtime = new Dictionary<ulong, RuntimePlayerState>();
        private readonly Dictionary<string, List<long>> _killHistory = new Dictionary<string, List<long>>();

        // Raid sessions keyed by building/cupboard/position-derived key
        private readonly Dictionary<string, RaidSession> _raids = new Dictionary<string, RaidSession>();

        // Event damage keyed by entity network id
        private readonly Dictionary<ulong, EventDamageSession> _eventDamage = new Dictionary<ulong, EventDamageSession>();

        // Crate hackers keyed by crate network id
        private readonly Dictionary<ulong, ulong> _crateHackers = new Dictionary<ulong, ulong>();

        // Prevent duplicate entity death awards
        private readonly HashSet<ulong> _processedDeaths = new HashSet<ulong>();

        private WebhookQueueData _webhookQueueData = new WebhookQueueData();
        private bool _webhookRequestInFlight;

        private SeasonApiQueueData _seasonApiQueueData = new SeasonApiQueueData();
        private bool _seasonApiRequestInFlight;
        private Coroutine _seasonApiCoroutine;
        private bool _seasonApiMaintenanceInFlight;
        private Coroutine _seasonApiMaintenanceCoroutine;
        private long _seasonApiRequestStartedUnixMs;
        private long _seasonApiSuccessCount;
        private long _seasonApiBackendAcceptedCount;
        private long _seasonApiBackendDuplicateCount;
        private long _seasonApiBackendRejectedCount;
        private long _seasonApiBackendStaleCount;
        private long _seasonApiBackendRemappedCount;
        private long _seasonApiFailureCount;
        private long _seasonApiRetryCount;
        private int _seasonApiLastHttpCode;
        private long _seasonApiLastSuccessUnixMs;
        private long _seasonApiLastFailureUnixMs;
        private long _seasonApiLastLatencyMs;
        private string _seasonApiLastError = "";
        private bool _sendWebhook = false; // V096: webhook legado removido; Season usa somente /api/season/*

        // Authoritative Season state is loaded from Railway into RAM.
        // No player/MMR state is read from or written to oxide/data.
        private bool _seasonStateReady;
        private bool _seasonBootstrapInFlight;
        private Coroutine _seasonBootstrapCoroutine;
        private long _seasonBootstrapLastAttemptUnixMs;
        private long _seasonBootstrapLastSuccessUnixMs;
        private string _seasonBootstrapLastError = "";
        private string _seasonBackendStatus = "desconhecido";

        #region Lifecycle

        private void Init()
        {
            InitializeRamData();
            InitializeWebhookQueueInMemory();
            InitializeSeasonApiQueueInMemory();
            permission.RegisterPermission("seasonmmr.admin", this);
        }

        private void OnServerInitialized()
        {
            // First restore the authoritative state from PostgreSQL. Until bootstrap
            // succeeds, scoring is paused so a reload can never reset somebody's MMR.
            StartSeasonBootstrap();

            foreach (var player in BasePlayer.activePlayerList)
                GetRuntime(player.userID);

            timer.Every(15f, () =>
            {
                if (!_seasonStateReady && !_seasonBootstrapInFlight)
                    StartSeasonBootstrap();
            });

            // Runtime-only maintenance. Gameplay/season state is kept in RAM and
            // sent to the Railway API; no gameplay data is persisted to oxide/data.
            timer.Every(Mathf.Max(30f, _config.SaveIntervalSeconds), () =>
            {
                // Railway/PostgreSQL is authoritative for the active Season.
                // Do not locally roll the month or disable scoring between month start
                // and the first Thursday; that used to silence all gameplay events.
                CleanupRuntime();
            });

            timer.Every(60f, CleanupRaidSessions);

            timer.Every(Mathf.Max(0.75f, _config.SeasonApi.SendIntervalSeconds), ProcessSeasonApiQueue);

            Puts("GuerraFriaSeason V111 carregado | base V105 preservada | eventos habilitados após bootstrap | Season API exclusiva /api/season/* | aguardando bootstrap do banco (RAM somente)");
        }
        // Intentionally do not persist gameplay/MMR data on server saves or plugin unloads.
        private void OnServerSave() { }

        private void Unload()
        {
            if (_seasonApiCoroutine != null && ServerMgr.Instance != null)
            {
                ServerMgr.Instance.StopCoroutine(_seasonApiCoroutine);
                _seasonApiCoroutine = null;
            }
            if (_seasonApiMaintenanceCoroutine != null && ServerMgr.Instance != null)
            {
                ServerMgr.Instance.StopCoroutine(_seasonApiMaintenanceCoroutine);
                _seasonApiMaintenanceCoroutine = null;
            }
            if (_seasonBootstrapCoroutine != null && ServerMgr.Instance != null)
            {
                ServerMgr.Instance.StopCoroutine(_seasonBootstrapCoroutine);
                _seasonBootstrapCoroutine = null;
            }
            _seasonBootstrapInFlight = false;
            _seasonApiRequestInFlight = false;
            _seasonApiMaintenanceInFlight = false;
            _seasonApiRequestStartedUnixMs = 0;
        }

        #endregion

        #region Configuration

        protected override void LoadDefaultConfig()
        {
            _config = PluginConfig.CreateDefault();
            SaveConfig();
        }

        protected override void LoadConfig()
        {
            base.LoadConfig();

            try
            {
                _config = Config.ReadObject<PluginConfig>();
                if (_config == null) throw new Exception("Config nula");
            }
            catch (Exception ex)
            {
                PrintWarning($"Config inválida ({ex.Message}). Gerando padrão.");
                _config = PluginConfig.CreateDefault();
            }

            _config.Normalize();
            SaveConfig();
        }

        protected override void SaveConfig()
        {
            Config.WriteObject(_config, true);
        }

        #endregion

        #region Season

        private DateTime BrazilNow()
        {
            // Guerra Fria operates on Brasilia time (UTC-3).
            return DateTime.UtcNow.AddHours(-3);
        }

        private DateTime FirstThursday(int year, int month)
        {
            var first = new DateTime(year, month, 1, 0, 0, 0, DateTimeKind.Unspecified);
            int offset = ((int)DayOfWeek.Thursday - (int)first.DayOfWeek + 7) % 7;
            return first.AddDays(offset);
        }

        private bool IsSeasonWindowOpen(DateTime localNow)
        {
            DateTime start = FirstThursday(localNow.Year, localNow.Month);
            DateTime endExclusive = new DateTime(localNow.Year, localNow.Month, 1).AddMonths(1);
            return localNow >= start && localNow < endExclusive;
        }

        private void CheckSeasonRollover()
        {
            DateTime localNow = BrazilNow();
            string monthId = localNow.ToString("yyyy-MM");
            DateTime firstThursday = FirstThursday(localNow.Year, localNow.Month);
            bool windowOpen = IsSeasonWindowOpen(localNow);

            if (string.IsNullOrEmpty(_data.CurrentSeasonId))
            {
                _data.CurrentSeasonId = monthId;
                _data.SeasonActive = windowOpen;
                return;
            }

            // Month changed. The previous Season ends exactly when the previous month ends.
            if (_data.CurrentSeasonId != monthId)
            {
                if (_data.SeasonActive)
                {
                    EndSeasonInternal(_data.CurrentSeasonId);
                    _data.SeasonActive = false;
                    // DB/API is authoritative; no local data write.
                }

                // Days 1..first Thursday: next Season is only announced, no MMR is counted.
                if (localNow < firstThursday)
                    return;

                // First Thursday reached: NOW the next numbered Season begins.
                _data.CurrentSeasonNumber = Math.Max(1, _data.CurrentSeasonNumber) + 1;
                StartSeasonInternal(monthId);
                _data.SeasonActive = true;
                // DB/API is authoritative; no local data write.
                Puts($"Season {_data.CurrentSeasonNumber} iniciada automaticamente: {monthId}");
                return;
            }

            // Same month, but a server/plugin reload may have happened before opening time.
            if (!_data.SeasonActive && windowOpen)
            {
                StartSeasonInternal(monthId);
                _data.SeasonActive = true;
                // DB/API is authoritative; no local data write.
                Puts($"Season {_data.CurrentSeasonNumber} iniciada automaticamente: {monthId}");
            }
        }

        private void EndSeasonInternal(string seasonId)
        {
            var archive = new SeasonArchive
            {
                SeasonId = seasonId,
                EndedUnix = Now(),
                Top = _data.Players.Values
                    .OrderByDescending(x => x.Mmr)
                    .Take(_config.ArchiveTopPlayers)
                    .Select(CloneSummary)
                    .ToList()
            };

            _data.Archives.Add(archive);

            while (_data.Archives.Count > _config.MaxArchivedSeasons)
                _data.Archives.RemoveAt(0);
        }

        private void StartSeasonInternal(string newSeasonId)
        {
            _data.CurrentSeasonId = newSeasonId;
            _data.SeasonActive = true;

            foreach (var player in _data.Players.Values)
            {
                player.Mmr = _config.StartingMMR;

                player.PvpRaidMmr = 0;
                player.FarmMmr = 0;
                player.BuildingMmr = 0;
                player.EventMmr = 0;
                player.OtherMmr = 0;

                player.PvpRaidPositiveEarned = 0;
                player.FarmPositiveEarned = 0;
                player.BuildingPositiveEarned = 0;
                player.EventPositiveEarned = 0;
                player.OtherPositiveEarned = 0;

                player.Kills = 0;
                player.Deaths = 0;
                player.HeadshotKills = 0;
                player.Assists = 0;

                player.Wood = 0;
                player.Stone = 0;
                player.MetalOre = 0;
                player.SulfurOre = 0;
                player.HqmOre = 0;

                player.BuildWood = 0;
                player.BuildStone = 0;
                player.BuildMetal = 0;
                player.BuildArmored = 0;

                player.RocketsUsed = 0;
                player.C4Used = 0;
                player.SatchelsUsed = 0;
                player.RaidStructuresDestroyed = 0;
                player.TcsDestroyed = 0;
                player.RaidsParticipated = 0;
                player.RaidsDefended = 0;

                player.BradleyParticipations = 0;
                player.HeliParticipations = 0;
                player.CratesHacked = 0;

                player.Ledger.Clear();
            }

            _killHistory.Clear();
            _raids.Clear();
            _eventDamage.Clear();
            _crateHackers.Clear();
            _processedDeaths.Clear();
        }

        private PlayerSummary CloneSummary(PlayerSeasonData p)
        {
            return new PlayerSummary
            {
                SteamId = p.SteamId,
                Name = p.Name,
                Mmr = p.Mmr,
                PvpRaidMmr = p.PvpRaidMmr,
                FarmMmr = p.FarmMmr,
                BuildingMmr = p.BuildingMmr,
                EventMmr = p.EventMmr,
                OtherMmr = p.OtherMmr,
                Kills = p.Kills,
                Deaths = p.Deaths
            };
        }

        #endregion

        #region Data

        private void InitializeRamData()
        {
            DateTime localNow = BrazilNow();
            _data = new StoredData
            {
                CurrentSeasonId = localNow.ToString("yyyy-MM"),
                CurrentSeasonNumber = 1,
                SeasonActive = IsSeasonWindowOpen(localNow),
                Players = new Dictionary<ulong, PlayerSeasonData>(),
                Archives = new List<SeasonArchive>()
            };
            _seasonStateReady = false;
        }
        // No ReadObject/WriteObject is used for Season player state. PostgreSQL is authoritative.

        private PlayerSeasonData EnsurePlayer(ulong userId, string name = null)
        {
            _data.Players ??= new Dictionary<ulong, PlayerSeasonData>();
            if (!_data.Players.TryGetValue(userId, out PlayerSeasonData data))
            {
                data = new PlayerSeasonData
                {
                    SteamId = userId,
                    Name = name ?? userId.ToString(),
                    Mmr = _config.StartingMMR,
                    LastSeenUnix = Now()
                };
                _data.Players[userId] = data;
            }

            if (!string.IsNullOrWhiteSpace(name))
                data.Name = name;

            data.LastSeenUnix = Now();
            return data;
        }

        #endregion

        #region Player Runtime / Fresh Spawn

        private void OnPlayerConnected(BasePlayer player)
        {
            if (player == null) return;
            EnsurePlayer(player.userID, player.displayName);
            GetRuntime(player.userID);
        }

        private void OnPlayerRespawned(BasePlayer player)
        {
            if (player == null) return;

            var state = GetRuntime(player.userID);
            state.LastRespawnUnix = Now();
            state.AggressiveSinceRespawn = false;

            var pdata = EnsurePlayer(player.userID, player.displayName);
            pdata.LastRespawnUnix = state.LastRespawnUnix;
        }

        private void OnPlayerAttack(BasePlayer attacker, HitInfo info)
        {
            if (attacker == null || info == null) return;

            var victim = info.HitEntity as BasePlayer;
            if (victim == null || victim == attacker) return;

            var state = GetRuntime(attacker.userID);

            if (IsWithinFreshSpawnWindow(attacker.userID))
                state.AggressiveSinceRespawn = true;

            state.LastPvpAttackUnix = Now();
        }

        private RuntimePlayerState GetRuntime(ulong userId)
        {
            RuntimePlayerState state;
            if (!_runtime.TryGetValue(userId, out state))
            {
                state = new RuntimePlayerState();
                _runtime[userId] = state;
            }
            return state;
        }

        private bool IsWithinFreshSpawnWindow(ulong userId)
        {
            var state = GetRuntime(userId);
            if (state.LastRespawnUnix <= 0) return false;
            return Now() - state.LastRespawnUnix <= _config.FreshSpawn.ProtectionSeconds;
        }

        private bool IsProtectedFreshSpawn(BasePlayer player)
        {
            if (!_config.FreshSpawn.Enabled || player == null) return false;
            if (!IsWithinFreshSpawnWindow(player.userID)) return false;

            var state = GetRuntime(player.userID);

            if (_config.FreshSpawn.CancelWhenAttacking && state.AggressiveSinceRespawn)
                return false;

            if (GetGearScore(player) > _config.FreshSpawn.MaxProtectedGearScore)
                return false;

            if (HasMeaningfulWeapon(player))
                return false;

            return true;
        }

        private void CleanupRuntime()
        {
            long cutoff = Now() - 86400;

            foreach (var key in _killHistory.Keys.ToList())
            {
                _killHistory[key].RemoveAll(x => x < Now() - _config.AntiFarm.RepeatKillWindowSeconds);
                if (_killHistory[key].Count == 0)
                    _killHistory.Remove(key);
            }

            foreach (var id in _processedDeaths.ToList())
            {
                // Net IDs can eventually recycle; periodic reset is enough for a season plugin.
                if (_processedDeaths.Count > 10000)
                {
                    _processedDeaths.Clear();
                    break;
                }
            }
        }

        #endregion

        #region PvP

        private void OnPlayerDeath(BasePlayer victim, HitInfo info)
        {
            if (!_seasonStateReady || !_data.SeasonActive) return;
            if (victim == null) return;

            var victimData = EnsurePlayer(victim.userID, victim.displayName);

            // NPC/animal deaths are handled separately from player PvP.
            if (TryApplyNpcAnimalDeathPenalty(victim, info, victimData))
                return;
            var attacker = info?.InitiatorPlayer;

            if (attacker == null || attacker == victim || attacker.userID == 0)
                return;

            var attackerData = EnsurePlayer(attacker.userID, attacker.displayName);

            if (SameTeam(attacker, victim))
            {
                AddLedger(attackerData, "PVP_RAID", "TEAM_KILL_BLOCKED", 0, 0, 0,
                    $"Kill em membro do mesmo time: {victim.displayName}");
                return;
            }

            if (IsProtectedFreshSpawn(victim))
            {
                attackerData.Kills++;
                victimData.Deaths++;

                AddLedger(attackerData, "PVP_RAID", "FRESH_SPAWN_KILL", 0, 0, 0,
                    $"0 MMR: {victim.displayName} estava recém-spawnado e low gear");

                AddLedger(victimData, "PVP_RAID", "FRESH_SPAWN_DEATH", 0, 0, 0,
                    $"0 perda: proteção de fresh spawn contra {attacker.displayName}");

                if (_config.Webhook != null && _config.Webhook.LogZeroValueEvents)
                {
                    SendMmrWebhook(attackerData, "PVP_RAID", "FRESH_SPAWN_KILL", 0, 0, 0,
                        $"{victim.displayName} estava recém-spawnado e low gear");
                    SendMmrWebhook(victimData, "PVP_RAID", "FRESH_SPAWN_DEATH", 0, 0, 0,
                        $"Proteção de fresh spawn contra {attacker.displayName}");
                }

                return;
            }

            KillContext ctx = BuildKillContext(attacker, victim, info);

            double killValue = CalculateKillMmr(ctx);
            double deathValue = CalculateDeathMmr(ctx);

            attackerData.Kills++;
            victimData.Deaths++;

            if (ctx.Headshot)
                attackerData.HeadshotKills++;

            if (killValue > 0)
                ApplyMmr(attackerData, "PVP_RAID", "KILL", killValue, BuildKillDetails(ctx));
            else
                AddLedger(attackerData, "PVP_RAID", "KILL_ZERO", ctx.BaseWeaponValue, ctx.FinalKillMultiplier, 0, BuildKillDetails(ctx));

            if (deathValue < 0)
                ApplyMmr(victimData, "PVP_RAID", "DEATH", deathValue,
                    $"Morto por {attacker.displayName} | {ctx.WeaponShortname}");

            RegisterKill(attacker.userID, victim.userID);

            // If PvP happens during a nearby raid, attribute the kill to that raid session.
            AttributeRaidPvp(attacker, victim);
        }

        private KillContext BuildKillContext(BasePlayer attacker, BasePlayer victim, HitInfo info)
        {
            var attackerData = EnsurePlayer(attacker.userID, attacker.displayName);
            var victimData = EnsurePlayer(victim.userID, victim.displayName);

            string weapon = GetWeaponShortname(info);

            return new KillContext
            {
                AttackerId = attacker.userID,
                VictimId = victim.userID,
                AttackerName = attacker.displayName,
                VictimName = victim.displayName,
                WeaponShortname = weapon,
                Headshot = info != null && info.isHeadshot,
                Distance = Vector3.Distance(attacker.transform.position, victim.transform.position),
                AttackerMmr = attackerData.Mmr,
                VictimMmr = victimData.Mmr,
                AttackerGearScore = GetGearScore(attacker),
                VictimGearScore = GetGearScore(victim),
                RepeatedKills = CountRecentKills(attacker.userID, victim.userID),
                BaseWeaponValue = GetWeaponBaseValue(weapon),
                VictimNaked = GetGearScore(victim) <= _config.Pvp.NakedGearScore
            };
        }

        private double CalculateKillMmr(KillContext ctx)
        {
            // Killing a naked player never awards MMR, regardless of weapon,
            // headshot, distance, MMR difference or values from an older config file.
            if (ctx.VictimNaked)
            {
                ctx.NakedMultiplier = 0.0;
                ctx.FinalKillMultiplier = 0.0;
                return 0;
            }

            ctx.NakedMultiplier = 1.0;

            ctx.GearMultiplier = GetGearMultiplier(ctx);
            ctx.MmrMultiplier = GetMmrDifferenceMultiplier(ctx);
            ctx.HeadshotMultiplier = ctx.Headshot ? _config.Pvp.HeadshotMultiplier : 1.0;
            ctx.DistanceMultiplier = GetDistanceMultiplier(ctx);
            ctx.RepeatMultiplier = GetRepeatedVictimMultiplier(ctx.RepeatedKills);

            ctx.FinalKillMultiplier =
                ctx.GearMultiplier *
                ctx.MmrMultiplier *
                ctx.HeadshotMultiplier *
                ctx.DistanceMultiplier *
                ctx.RepeatMultiplier *
                ctx.NakedMultiplier;

            double value = ctx.BaseWeaponValue * ctx.FinalKillMultiplier;

            if (value < _config.Pvp.MinimumKillMMR)
                return 0;

            return Math.Round(value, 3);
        }

        private double CalculateDeathMmr(KillContext ctx)
        {
            if (!_config.Pvp.DeathPenaltyEnabled) return 0;

            double weaponDifficulty = GetDeathWeaponMultiplier(ctx.WeaponShortname);
            double gearFactor = 1.0;

            if (ctx.AttackerGearScore + 10 < ctx.VictimGearScore)
                gearFactor = 1.25;
            else if (ctx.AttackerGearScore > ctx.VictimGearScore + 50)
                gearFactor = 0.70;

            // Deaths now scale strongly with the MMR mismatch.
            // A high-MMR player dying to a much lower-MMR player is punished harder,
            // while an underdog dying to a much higher-MMR player loses less.
            double mmrFactor = GetDeathMmrDifferenceMultiplier(ctx);
            double repeatProtection = GetRepeatedVictimMultiplier(ctx.RepeatedKills);

            double penalty = _config.Pvp.BaseDeathPenalty *
                             weaponDifficulty *
                             gearFactor *
                             mmrFactor *
                             repeatProtection;

            penalty = Math.Max(_config.Pvp.MinimumDeathPenalty, penalty);
            penalty = Math.Min(_config.Pvp.MaximumDeathPenalty, penalty);

            return -Math.Round(penalty, 3);
        }

        private double GetDeathMmrDifferenceMultiplier(KillContext ctx)
        {
            // Positive diff = victim has MORE MMR than the killer -> bigger punishment.
            double diff = ctx.VictimMmr - ctx.AttackerMmr;

            if (diff >= 1000) return 3.00;
            if (diff >= 750)  return 2.60;
            if (diff >= 500)  return 2.20;
            if (diff >= 300)  return 1.80;
            if (diff >= 150)  return 1.40;

            // Victim was the underdog. Reduce the loss, but never make death free.
            if (diff <= -1000) return 0.40;
            if (diff <= -750)  return 0.50;
            if (diff <= -500)  return 0.60;
            if (diff <= -300)  return 0.72;
            if (diff <= -150)  return 0.85;

            return 1.0;
        }

        private string BuildKillDetails(KillContext ctx)
        {
            return $"{ctx.WeaponShortname} | HS={ctx.Headshot} | {ctx.Distance:0}m | " +
                   $"Gear={ctx.AttackerGearScore:0}/{ctx.VictimGearScore:0} | " +
                   $"MMR={ctx.AttackerMmr:0}/{ctx.VictimMmr:0} | repeat={ctx.RepeatedKills} | " +
                   $"mult={ctx.FinalKillMultiplier:0.###}";
        }

        #endregion

        #region Kill Anti-Farm

        private string PairKey(ulong attacker, ulong victim) => attacker + ":" + victim;

        private int CountRecentKills(ulong attacker, ulong victim)
        {
            string key = PairKey(attacker, victim);
            List<long> list;

            if (!_killHistory.TryGetValue(key, out list))
                return 0;

            long cutoff = Now() - _config.AntiFarm.RepeatKillWindowSeconds;
            list.RemoveAll(x => x < cutoff);
            return list.Count;
        }

        private void RegisterKill(ulong attacker, ulong victim)
        {
            string key = PairKey(attacker, victim);
            List<long> list;

            if (!_killHistory.TryGetValue(key, out list))
            {
                list = new List<long>();
                _killHistory[key] = list;
            }

            long cutoff = Now() - _config.AntiFarm.RepeatKillWindowSeconds;
            list.RemoveAll(x => x < cutoff);
            list.Add(Now());
        }

        private double GetRepeatedVictimMultiplier(int previousKills)
        {
            var values = _config.AntiFarm.RepeatedKillMultipliers;
            if (values == null || values.Count == 0) return 1.0;

            int index = Math.Min(previousKills, values.Count - 1);
            return Math.Max(0, values[index]);
        }

        #endregion

        #region NPCs / Animals

        private void OnEntityDeath(BaseCombatEntity entity, HitInfo info)
        {
            HandleNpcAnimalEntityDeath(entity, info);
            if (entity == null || info == null || !_seasonStateReady || !_data.SeasonActive) return;

            var attacker = info.InitiatorPlayer;

            // Scientists / humanoid NPCs
            var npc = entity as BasePlayer;
            if (npc != null && npc.IsNpc)
            {
                if (attacker != null && !attacker.IsNpc)
                {
                    var data = EnsurePlayer(attacker.userID, attacker.displayName);
                    double value = GetNpcKillMmr(npc);
                    if (value > 0)
                        ApplyMmr(data, "EVENT", "NPC_KILL", value, $"npc={npc.ShortPrefabName}");
                }
                return;
            }

            // Animals
            var animal = entity as BaseNpc;
            if (animal != null && attacker != null && !attacker.IsNpc)
            {
                var data = EnsurePlayer(attacker.userID, attacker.displayName);
                double value = GetAnimalKillMmr(entity.ShortPrefabName);
                if (value > 0)
                    ApplyMmr(data, "EVENT", "ANIMAL_KILL", value, $"animal={entity.ShortPrefabName}");
            }
        }

        private double GetNpcKillMmr(BasePlayer npc)
        {
            string n = (npc.ShortPrefabName ?? "").ToLowerInvariant();
            if (n.Contains("heavy")) return _config.NpcAnimals.HeavyScientistKillMMR;
            if (n.Contains("scientist")) return _config.NpcAnimals.ScientistKillMMR;
            if (n.Contains("murderer") || n.Contains("scarecrow")) return _config.NpcAnimals.MurdererKillMMR;
            return _config.NpcAnimals.OtherNpcKillMMR;
        }

        private double GetAnimalKillMmr(string prefab)
        {
            string n = (prefab ?? "").ToLowerInvariant();
            if (n.Contains("bear")) return _config.NpcAnimals.BearKillMMR;
            if (n.Contains("polar")) return _config.NpcAnimals.PolarBearKillMMR;
            if (n.Contains("wolf")) return _config.NpcAnimals.WolfKillMMR;
            if (n.Contains("boar")) return _config.NpcAnimals.BoarKillMMR;
            if (n.Contains("stag")) return _config.NpcAnimals.StagKillMMR;
            return _config.NpcAnimals.OtherAnimalKillMMR;
        }

        private bool TryApplyNpcAnimalDeathPenalty(BasePlayer victim, HitInfo info, PlayerSeasonData data)
        {
            if (victim == null || info == null || data == null) return false;
            var initiator = info.Initiator as BaseEntity;
            if (initiator == null) return false;

            var npc = initiator as BasePlayer;
            if (npc != null && npc.IsNpc)
            {
                double loss = _config.NpcAnimals.NpcDeathPenalty;
                string n = (npc.ShortPrefabName ?? "").ToLowerInvariant();
                if (n.Contains("heavy")) loss = _config.NpcAnimals.HeavyScientistDeathPenalty;
                ApplyMmr(data, "EVENT", "DEATH_TO_NPC", -Math.Abs(loss), $"npc={npc.ShortPrefabName}");
                return true;
            }

            if (initiator is BaseNpc)
            {
                string n = (initiator.ShortPrefabName ?? "").ToLowerInvariant();
                double loss = _config.NpcAnimals.AnimalDeathPenalty;
                if (n.Contains("bear") || n.Contains("polar")) loss = _config.NpcAnimals.BearDeathPenalty;
                else if (n.Contains("wolf")) loss = _config.NpcAnimals.WolfDeathPenalty;
                ApplyMmr(data, "EVENT", "DEATH_TO_ANIMAL", -Math.Abs(loss), $"animal={initiator.ShortPrefabName}");
                return true;
            }
            return false;
        }

        #endregion

        #region Farm

        private void OnDispenserGather(ResourceDispenser dispenser, BaseEntity entity, Item item)
        {
            var player = entity as BasePlayer;
            if (player == null || item == null) return;
            RegisterFarm(player, item);
        }

        private void OnDispenserBonus(ResourceDispenser dispenser, BasePlayer player, Item item)
        {
            if (player == null || item == null) return;
            RegisterFarm(player, item);
        }

        private void OnCollectiblePickedup(Item item, BasePlayer player, CollectibleEntity entity)
        {
            if (player == null || item == null) return;
            RegisterFarm(player, item);
        }

        private void RegisterFarm(BasePlayer player, Item item)
        {
            if (!_seasonStateReady || !_data.SeasonActive) return;
            string shortname = item.info?.shortname;
            if (string.IsNullOrEmpty(shortname) || item.amount <= 0) return;

            var data = EnsurePlayer(player.userID, player.displayName);

            double per1000;

            switch (shortname)
            {
                case "wood":
                    data.Wood += item.amount;
                    per1000 = _config.Farm.WoodPer1000;
                    break;

                case "stones":
                    data.Stone += item.amount;
                    per1000 = _config.Farm.StonePer1000;
                    break;

                case "metal.ore":
                    data.MetalOre += item.amount;
                    per1000 = _config.Farm.MetalPer1000;
                    break;

                case "sulfur.ore":
                    data.SulfurOre += item.amount;
                    per1000 = _config.Farm.SulfurPer1000;
                    break;

                case "hq.metal.ore":
                    data.HqmOre += item.amount;
                    per1000 = _config.Farm.HqmPer1000;
                    break;

                default:
                    return;
            }

            double raw = (item.amount / 1000.0) * per1000;
            if (raw <= 0) return;

            ApplyMmr(data, "FARM", "GATHER_" + shortname, raw, $"{item.amount}x {shortname}");
        }

        #endregion

        #region Building / Progression

        private void OnStructureUpgraded(BuildingBlock block, BasePlayer player, BuildingGrade.Enum grade, ulong skin)
        {
            if (!_seasonStateReady || !_data.SeasonActive) return;
            if (block == null || player == null) return;

            var data = EnsurePlayer(player.userID, player.displayName);

            double raw;
            string type;

            switch (grade)
            {
                case BuildingGrade.Enum.Wood:
                    raw = _config.Building.WoodUpgradeMMR;
                    type = "UPGRADE_WOOD";
                    data.BuildWood++;
                    break;

                case BuildingGrade.Enum.Stone:
                    raw = _config.Building.StoneUpgradeMMR;
                    type = "UPGRADE_STONE";
                    data.BuildStone++;
                    break;

                case BuildingGrade.Enum.Metal:
                    raw = _config.Building.MetalUpgradeMMR;
                    type = "UPGRADE_METAL";
                    data.BuildMetal++;
                    break;

                case BuildingGrade.Enum.TopTier:
                    raw = _config.Building.ArmoredUpgradeMMR;
                    type = "UPGRADE_ARMORED";
                    data.BuildArmored++;
                    break;

                default:
                    return;
            }

            // Anti-abuse: owner must match player or be unowned; team-built bases still work through ownership.
            if (block.OwnerID != 0 && block.OwnerID != player.userID && !_config.Building.AllowTeamOwnedUpgrades)
                return;

            ApplyMmr(data, "BUILDING", type, raw, $"grade={grade} entity={block.ShortPrefabName}");
        }

        private void OnEntityBuilt(Planner planner, GameObject go)
        {
            if (!_seasonStateReady || !_data.SeasonActive) return;
            if (!_config.Building.TrackDeployables || planner == null || go == null) return;

            var player = planner.GetOwnerPlayer();
            if (player == null) return;

            var entity = go.ToBaseEntity();
            if (entity == null) return;

            string shortname = entity.ShortPrefabName ?? "";
            double value;

            if (!_config.Building.DeployableMMR.TryGetValue(shortname, out value))
                return;

            var data = EnsurePlayer(player.userID, player.displayName);
            ApplyMmr(data, "BUILDING", "DEPLOY_" + shortname, value, shortname);
        }

        #endregion

        #region Raid Tracking

        private void OnEntityTakeDamage(BaseCombatEntity entity, HitInfo info)
        {
            if (!_seasonStateReady || !_data.SeasonActive) return;
            if (entity == null || info == null) return;

            TrackEventDamage(entity, info);

            var attacker = info.InitiatorPlayer;
            if (attacker == null || attacker.userID == 0) return;

            if (!IsRaidTarget(entity)) return;
            if (!IsRaidDamage(info)) return;

            ulong ownerId = entity.OwnerID;

            if (ownerId == 0 || ownerId == attacker.userID)
                return;

            if (AreUsersSameTeam(attacker.userID, ownerId))
                return;

            string raidKey = GetRaidKey(entity);
            RaidSession raid;

            if (!_raids.TryGetValue(raidKey, out raid))
            {
                raid = new RaidSession
                {
                    Id = raidKey,
                    TargetOwnerId = ownerId,
                    Center = entity.transform.position,
                    StartedUnix = Now(),
                    LastActivityUnix = Now()
                };
                _raids[raidKey] = raid;
            }

            RefreshRaidDefenders(raid, entity, ownerId);
            raid.LastActivityUnix = Now();
            raid.Center = entity.transform.position;
            raid.Attackers.Add(attacker.userID);

            string weapon = GetWeaponShortname(info);
            double raw = GetRaidHitValue(weapon, entity);

            if (weapon.Contains("rocket"))
            {
                raid.Rockets++;
                EnsurePlayer(attacker.userID, attacker.displayName).RocketsUsed++;
            }
            else if (weapon.Contains("explosive.timed") || weapon.Contains("c4"))
            {
                raid.C4++;
                EnsurePlayer(attacker.userID, attacker.displayName).C4Used++;
            }
            else if (weapon.Contains("satchel"))
            {
                raid.Satchels++;
                EnsurePlayer(attacker.userID, attacker.displayName).SatchelsUsed++;
            }

            if (raw > 0)
            {
                var data = EnsurePlayer(attacker.userID, attacker.displayName);
                double raidMultiplier = GetRaidScoreMultiplier(raid);
                raid.LastScoreMultiplier = raidMultiplier;
                double finalValue = raw * raidMultiplier;
                ApplyMmr(data, "PVP_RAID", "RAID_DAMAGE", finalValue,
                    $"{weapon} -> {entity.ShortPrefabName} | raid={raid.Id} | mult={raidMultiplier:0.###} | defenders={raid.Defenders.Count} online={CountOnlineRaidDefenders(raid)} avgVictimMmr={GetRaidDefenderAverageMmr(raid):0}");
            }
        }

        private void HandleNpcAnimalEntityDeath(BaseCombatEntity entity, HitInfo info)
        {
            if (!_seasonStateReady || !_data.SeasonActive) return;
            if (entity == null) return;

            ulong netId = GetNetId(entity);
            if (netId != 0 && _processedDeaths.Contains(netId))
                return;

            if (netId != 0)
                _processedDeaths.Add(netId);

            HandleEventDeath(entity, info);

            if (!IsRaidTarget(entity)) return;

            var attacker = info?.InitiatorPlayer;
            if (attacker == null || attacker.userID == 0) return;

            if (entity.OwnerID == 0 || entity.OwnerID == attacker.userID) return;
            if (AreUsersSameTeam(attacker.userID, entity.OwnerID)) return;

            string raidKey = GetRaidKey(entity);
            RaidSession raid;

            if (!_raids.TryGetValue(raidKey, out raid))
            {
                raid = new RaidSession
                {
                    Id = raidKey,
                    TargetOwnerId = entity.OwnerID,
                    Center = entity.transform.position,
                    StartedUnix = Now(),
                    LastActivityUnix = Now()
                };
                _raids[raidKey] = raid;
            }

            RefreshRaidDefenders(raid, entity, entity.OwnerID);
            raid.LastActivityUnix = Now();
            raid.Attackers.Add(attacker.userID);
            raid.StructuresDestroyed++;

            var data = EnsurePlayer(attacker.userID, attacker.displayName);
            data.RaidStructuresDestroyed++;

            double raw = GetDestroyedEntityRaidValue(entity);
            string type = "RAID_DESTROY_" + (entity.ShortPrefabName ?? "entity");

            if (entity is BuildingPrivlidge)
            {
                raw += _config.Raid.TcDestroyedBonus;
                type = "RAID_TC_DESTROYED";
                raid.TcDestroyed = true;
                data.TcsDestroyed++;
            }

            if (raw > 0)
            {
                double raidMultiplier = GetRaidScoreMultiplier(raid);
                raid.LastScoreMultiplier = raidMultiplier;
                double finalValue = raw * raidMultiplier;
                ApplyMmr(data, "PVP_RAID", type, finalValue,
                    $"raid={raid.Id} | mult={raidMultiplier:0.###} | defenders={raid.Defenders.Count} online={CountOnlineRaidDefenders(raid)} avgVictimMmr={GetRaidDefenderAverageMmr(raid):0}");
            }
        }

        // Raid payout = defender-online factor x defender-MMR factor.
        // 0 online => 20%; partial team online => 50%; all TC-authorized online => 100%.
        // A solo TC therefore pays 100% when its only authorized player is online.
        private void RefreshRaidDefenders(RaidSession raid, BaseCombatEntity entity, ulong fallbackOwnerId)
        {
            if (raid == null) return;

            BuildingPrivlidge tc = entity as BuildingPrivlidge ?? entity?.GetBuildingPrivilege();
            if (tc != null && tc.authorizedPlayers != null && tc.authorizedPlayers.Count > 0)
            {
                foreach (ulong authId in tc.authorizedPlayers)
                {
                    if (authId != 0)
                        raid.Defenders.Add(authId);
                }
            }

            if (raid.Defenders.Count == 0 && fallbackOwnerId != 0)
                raid.Defenders.Add(fallbackOwnerId);
        }

        private int CountOnlineRaidDefenders(RaidSession raid)
        {
            if (raid == null || raid.Defenders == null) return 0;
            int online = 0;
            foreach (ulong id in raid.Defenders)
            {
                BasePlayer p = BasePlayer.FindByID(id);
                if (p != null && p.IsConnected) online++;
            }
            return online;
        }

        private double GetRaidOnlineMultiplier(RaidSession raid)
        {
            int total = raid?.Defenders?.Count ?? 0;
            if (total <= 0) return _config.Raid.OfflinePayoutMultiplier;

            int online = CountOnlineRaidDefenders(raid);
            if (online <= 0) return _config.Raid.OfflinePayoutMultiplier;
            if (online >= total) return _config.Raid.FullOnlinePayoutMultiplier;
            return _config.Raid.PartialOnlinePayoutMultiplier;
        }

        private double GetRaidDefenderAverageMmr(RaidSession raid)
        {
            if (raid == null || raid.Defenders == null || raid.Defenders.Count == 0)
                return _config.StartingMMR;

            double total = 0;
            int count = 0;
            foreach (ulong id in raid.Defenders)
            {
                PlayerSeasonData p;
                if (_data.Players != null && _data.Players.TryGetValue(id, out p) && p != null)
                    total += p.Mmr;
                else
                    total += _config.StartingMMR;
                count++;
            }
            return count > 0 ? total / count : _config.StartingMMR;
        }

        private double GetRaidVictimMmrMultiplier(RaidSession raid)
        {
            double avg = GetRaidDefenderAverageMmr(raid);
            double steps = (avg - _config.Raid.VictimMmrNeutralPoint) / Math.Max(1.0, _config.Raid.VictimMmrStep);
            double mult = 1.0 + (steps * _config.Raid.VictimMmrMultiplierPerStep);
            return Math.Max(_config.Raid.VictimMmrMinMultiplier, Math.Min(_config.Raid.VictimMmrMaxMultiplier, mult));
        }

        private double GetRaidScoreMultiplier(RaidSession raid)
        {
            return GetRaidOnlineMultiplier(raid) * GetRaidVictimMmrMultiplier(raid);
        }

        private bool IsRaidTarget(BaseCombatEntity entity)
        {
            if (entity is BasePlayer) return false;

            return entity is BuildingBlock ||
                   entity is Door ||
                   entity is BuildingPrivlidge ||
                   entity is StorageContainer ||
                   entity.ShortPrefabName.Contains("wall.external") ||
                   entity.ShortPrefabName.Contains("barricade");
        }

        private bool IsRaidDamage(HitInfo info)
        {
            if (info?.damageTypes == null) return false;

            if (info.damageTypes.Has(Rust.DamageType.Explosion))
                return true;

            string weapon = GetWeaponShortname(info);

            return weapon.Contains("rocket") ||
                   weapon.Contains("explosive") ||
                   weapon.Contains("satchel") ||
                   weapon.Contains("grenade");
        }

        private string GetRaidKey(BaseCombatEntity entity)
        {
            var priv = entity.GetBuildingPrivilege();
            if (priv != null)
            {
                ulong id = GetNetId(priv);
                if (id != 0) return "tc:" + id;
            }

            var decay = entity as DecayEntity;
            if (decay != null && decay.buildingID != 0)
                return "building:" + decay.buildingID;

            Vector3 p = entity.transform.position;
            int x = Mathf.RoundToInt(p.x / 40f);
            int z = Mathf.RoundToInt(p.z / 40f);
            return $"cell:{x}:{z}:{entity.OwnerID}";
        }

        private double GetRaidHitValue(string weapon, BaseCombatEntity entity)
        {
            if (weapon.Contains("rocket")) return _config.Raid.RocketUsefulHitMMR;
            if (weapon.Contains("explosive.timed") || weapon.Contains("c4")) return _config.Raid.C4UsefulHitMMR;
            if (weapon.Contains("satchel")) return _config.Raid.SatchelUsefulHitMMR;
            if (weapon.Contains("explosive")) return _config.Raid.ExplosiveAmmoUsefulHitMMR;
            return 0;
        }

        private double GetDestroyedEntityRaidValue(BaseCombatEntity entity)
        {
            if (entity is BuildingPrivlidge) return _config.Raid.TcEntityBaseMMR;

            var block = entity as BuildingBlock;
            if (block != null)
            {
                switch (block.grade)
                {
                    case BuildingGrade.Enum.Wood: return _config.Raid.DestroyWoodStructureMMR;
                    case BuildingGrade.Enum.Stone: return _config.Raid.DestroyStoneStructureMMR;
                    case BuildingGrade.Enum.Metal: return _config.Raid.DestroyMetalStructureMMR;
                    case BuildingGrade.Enum.TopTier: return _config.Raid.DestroyArmoredStructureMMR;
                }
            }

            string sn = entity.ShortPrefabName ?? "";

            if (sn.Contains("door.hinged.wood")) return _config.Raid.DestroyWoodDoorMMR;
            if (sn.Contains("door.hinged.metal")) return _config.Raid.DestroyMetalDoorMMR;
            if (sn.Contains("wall.frame.garagedoor") || sn.Contains("garage")) return _config.Raid.DestroyGarageDoorMMR;
            if (sn.Contains("door.hinged.toptier")) return _config.Raid.DestroyArmoredDoorMMR;

            return _config.Raid.DestroyOtherRaidEntityMMR;
        }

        private void AttributeRaidPvp(BasePlayer attacker, BasePlayer victim)
        {
            RaidSession nearest = null;
            float best = _config.Raid.PvpAttributionRadius;

            foreach (var raid in _raids.Values)
            {
                if (Now() - raid.LastActivityUnix > _config.Raid.SessionTimeoutSeconds) continue;

                float d = Vector3.Distance(victim.transform.position, raid.Center);
                if (d <= best)
                {
                    best = d;
                    nearest = raid;
                }
            }

            if (nearest == null) return;

            nearest.LastActivityUnix = Now();

            if (nearest.Attackers.Contains(attacker.userID))
                nearest.AttackerPvpKills++;
            else if (nearest.Defenders.Contains(attacker.userID) || attacker.userID == nearest.TargetOwnerId)
            {
                nearest.Defenders.Add(attacker.userID);
                nearest.DefenderPvpKills++;
            }
        }

        private void CleanupRaidSessions()
        {
            long now = Now();
            var expired = _raids.Values
                .Where(r => now - r.LastActivityUnix > _config.Raid.SessionTimeoutSeconds)
                .ToList();

            foreach (var raid in expired)
            {
                FinishRaid(raid);
                _raids.Remove(raid.Id);
            }
        }

        private void FinishRaid(RaidSession raid)
        {
            if (raid == null) return;

            foreach (ulong attackerId in raid.Attackers)
            {
                var p = EnsurePlayer(attackerId);
                p.RaidsParticipated++;

                double bonus = _config.Raid.CompletedRaidParticipationMMR;

                if (raid.TcDestroyed)
                    bonus += _config.Raid.CompletedRaidTcBonus;

                bonus += Math.Min(_config.Raid.MaxPvpRaidSessionBonus,
                    raid.AttackerPvpKills * _config.Raid.PvpKillSessionBonus);

                if (bonus > 0)
                {
                    double raidMultiplier = raid.LastScoreMultiplier > 0 ? raid.LastScoreMultiplier : GetRaidScoreMultiplier(raid);
                    ApplyMmr(p, "PVP_RAID", "RAID_SESSION_COMPLETE", bonus * raidMultiplier,
                        $"raid={raid.Id} tc={raid.TcDestroyed} destroyed={raid.StructuresDestroyed} mult={raidMultiplier:0.###}");
                }
            }

            if (!raid.TcDestroyed && raid.Attackers.Count > 0)
            {
                foreach (ulong defenderId in raid.Defenders)
                {
                    var p = EnsurePlayer(defenderId);
                    p.RaidsDefended++;

                    double bonus = _config.Raid.DefenseSuccessMMR +
                                   Math.Min(_config.Raid.MaxPvpRaidSessionBonus,
                                       raid.DefenderPvpKills * _config.Raid.PvpKillSessionBonus);

                    ApplyMmr(p, "PVP_RAID", "RAID_DEFENDED", bonus,
                        $"raid={raid.Id} attackers={raid.Attackers.Count}");
                }
            }
        }

        #endregion

        #region Events

        private void TrackEventDamage(BaseCombatEntity entity, HitInfo info)
        {
            if (entity == null || info == null) return;

            bool bradley = entity is BradleyAPC;
            bool heli = entity is PatrolHelicopter;

            if (!bradley && !heli) return;

            var attacker = info.InitiatorPlayer;
            if (attacker == null || attacker.userID == 0) return;

            float dmg = info.damageTypes?.Total() ?? 0f;
            if (dmg <= 0) return;

            ulong id = GetNetId(entity);
            if (id == 0) return;

            EventDamageSession session;
            if (!_eventDamage.TryGetValue(id, out session))
            {
                session = new EventDamageSession
                {
                    EntityNetId = id,
                    Type = bradley ? "BRADLEY" : "HELI"
                };
                _eventDamage[id] = session;
            }

            float current;
            session.DamageByPlayer.TryGetValue(attacker.userID, out current);
            session.DamageByPlayer[attacker.userID] = current + dmg;
            session.LastActivityUnix = Now();
        }

        private void HandleEventDeath(BaseCombatEntity entity, HitInfo info)
        {
            bool bradley = entity is BradleyAPC;
            bool heli = entity is PatrolHelicopter;

            if (!bradley && !heli) return;

            ulong id = GetNetId(entity);
            EventDamageSession session;

            if (!_eventDamage.TryGetValue(id, out session))
            {
                session = new EventDamageSession
                {
                    EntityNetId = id,
                    Type = bradley ? "BRADLEY" : "HELI"
                };

                var killer = info?.InitiatorPlayer;
                if (killer != null)
                    session.DamageByPlayer[killer.userID] = 1f;
            }

            float total = session.DamageByPlayer.Values.Sum();
            if (total <= 0) return;

            double pool = bradley ? _config.Events.BradleyMMRPool : _config.Events.PatrolHeliMMRPool;

            foreach (var kv in session.DamageByPlayer)
            {
                float share = kv.Value / total;
                if (share < _config.Events.MinimumDamageShare)
                    continue;

                var p = EnsurePlayer(kv.Key);
                double value = pool * share;

                if (bradley) p.BradleyParticipations++;
                else p.HeliParticipations++;

                ApplyMmr(p, "EVENTS", bradley ? "BRADLEY" : "PATROL_HELI", value,
                    $"damageShare={share:P1}");
            }

            _eventDamage.Remove(id);
        }

        private object CanHackCrate(BasePlayer player, HackableLockedCrate crate)
        {
            if (!_seasonStateReady || !_data.SeasonActive) return null;
            if (crate == null || player == null) return null;

            ulong id = GetNetId(crate);
            if (id != 0)
                _crateHackers[id] = player.userID;

            return null;
        }

        private void OnCrateHack(HackableLockedCrate crate)
        {
            // Player is captured in CanHackCrate immediately before this hook.
        }

        private void OnCrateHackEnd(HackableLockedCrate crate)
        {
            if (crate == null) return;

            ulong id = GetNetId(crate);
            ulong playerId;

            if (id == 0 || !_crateHackers.TryGetValue(id, out playerId))
                return;

            var p = EnsurePlayer(playerId);
            p.CratesHacked++;

            ApplyMmr(p, "EVENTS", "LOCKED_CRATE_HACK", _config.Events.LockedCrateHackMMR,
                $"crate={id}");

            _crateHackers.Remove(id);
        }

        #endregion

        #region MMR Engine / Category Balancing

        private static double PopulationMultiplier(int population)
        {
            return population >= 100 ? 1.0 : population >= 30 ? 0.5 : 0.2;
        }

        private void ApplyMmr(PlayerSeasonData data, string category, string type, double rawDelta, string details)
        {
            // Never calculate against a blank state while the DB bootstrap is pending.
            if (!_seasonStateReady)
                return;

            // Between the 1st and the first Thursday, the next Season is in PRE-SEASON mode.
            // Gameplay is ignored for Season MMR until the official opening window starts.
            if (!_data.SeasonActive)
                return;

            if (data == null || Math.Abs(rawDelta) < 0.000001)
                return;

            double delta = rawDelta;
            double categoryMultiplier = 1.0;

            // Diminishing returns only reduce positive farming of score.
            // PvP+Raid and Farm intentionally share the same soft cap.
            if (delta > 0)
            {
                categoryMultiplier = GetCategoryDiminishingMultiplier(data, category);
                delta *= categoryMultiplier;
            }

            // Capture population when the action happens, before any webhook queue delay.
            int population = BasePlayer.activePlayerList.Count(p => p != null && p.IsConnected && !p.IsNpc);
            double populationMultiplier = PopulationMultiplier(population);
            delta *= populationMultiplier;
            categoryMultiplier *= populationMultiplier;

            double old = data.Mmr;
            data.Mmr = Math.Max(_config.MinimumMMR, Math.Round(data.Mmr + delta, 3));
            double applied = Math.Round(data.Mmr - old, 3);

            AddCategoryValue(data, category, applied);

            if (applied > 0)
                AddPositiveEarned(data, category, applied);

            string finalDetails = details + $" | scoreMultiplier={categoryMultiplier:0.###} | population={population} | populationMultiplier={populationMultiplier:0.###}";

            AddLedger(data, category, type, rawDelta, categoryMultiplier, applied, finalDetails);

            QueueSeasonApiEvent(data, category, type, rawDelta, categoryMultiplier, applied, finalDetails);
            SendMmrWebhook(data, category, type, rawDelta, categoryMultiplier, applied, finalDetails);
        }

        private void AddCategoryValue(PlayerSeasonData data, string category, double value)
        {
            switch (category)
            {
                case "PVP_RAID": data.PvpRaidMmr = Math.Round(data.PvpRaidMmr + value, 3); break;
                case "FARM": data.FarmMmr = Math.Round(data.FarmMmr + value, 3); break;
                case "BUILDING": data.BuildingMmr = Math.Round(data.BuildingMmr + value, 3); break;
                case "EVENTS": data.EventMmr = Math.Round(data.EventMmr + value, 3); break;
                default: data.OtherMmr = Math.Round(data.OtherMmr + value, 3); break;
            }
        }

        private void AddPositiveEarned(PlayerSeasonData data, string category, double value)
        {
            switch (category)
            {
                case "PVP_RAID": data.PvpRaidPositiveEarned += value; break;
                case "FARM": data.FarmPositiveEarned += value; break;
                case "BUILDING": data.BuildingPositiveEarned += value; break;
                case "EVENTS": data.EventPositiveEarned += value; break;
                default: data.OtherPositiveEarned += value; break;
            }
        }

        private double GetPositiveEarned(PlayerSeasonData data, string category)
        {
            switch (category)
            {
                case "PVP_RAID": return data.PvpRaidPositiveEarned;
                case "FARM": return data.FarmPositiveEarned;
                case "BUILDING": return data.BuildingPositiveEarned;
                case "EVENTS": return data.EventPositiveEarned;
                default: return data.OtherPositiveEarned;
            }
        }

        private double GetCategorySoftCap(string category)
        {
            switch (category)
            {
                case "PVP_RAID": return _config.Balance.PvpRaidSoftCap;
                case "FARM": return _config.Balance.FarmSoftCap;
                case "BUILDING": return _config.Balance.BuildingSoftCap;
                case "EVENTS": return _config.Balance.EventsSoftCap;
                default: return _config.Balance.OtherSoftCap;
            }
        }

        private double GetCategoryDiminishingMultiplier(PlayerSeasonData data, string category)
        {
            double earned = GetPositiveEarned(data, category);
            double cap = GetCategorySoftCap(category);

            if (cap <= 0) return 1.0;

            double ratio = earned / cap;

            if (ratio < 0.50) return 1.00;
            if (ratio < 0.80) return 0.90;
            if (ratio < 1.00) return 0.75;
            if (ratio < 1.50) return 0.55;
            if (ratio < 2.00) return 0.40;
            return _config.Balance.MinimumDiminishingMultiplier;
        }

        private void AddLedger(PlayerSeasonData data, string category, string type,
            double baseValue, double multiplier, double finalValue, string details)
        {
            if (data.Ledger == null)
                data.Ledger = new List<MmrTransaction>();

            data.Ledger.Add(new MmrTransaction
            {
                TimestampUnix = Now(),
                Category = category,
                Type = type,
                BaseValue = Math.Round(baseValue, 3),
                Multiplier = Math.Round(multiplier, 3),
                FinalValue = Math.Round(finalValue, 3),
                ResultingMmr = data.Mmr,
                Details = details
            });

            int excess = data.Ledger.Count - _config.MaxLedgerEntriesPerPlayer;
            if (excess > 0)
                data.Ledger.RemoveRange(0, excess);
        }

        #endregion


        #region Railway Season Bootstrap

        private void StartSeasonBootstrap()
        {
            if (_seasonBootstrapInFlight || _seasonStateReady) return;
            if (_config?.SeasonApi == null || !_config.SeasonApi.Enabled ||
                string.IsNullOrWhiteSpace(SeasonBootstrapEndpoint) ||
                string.IsNullOrWhiteSpace(_config.SeasonApi.Secret))
            {
                _seasonBootstrapLastError = "API de bootstrap não configurada";
                return;
            }

            _seasonBootstrapInFlight = true;
            _seasonBootstrapLastAttemptUnixMs = UnixMs();
            _seasonBootstrapCoroutine = ServerMgr.Instance.StartCoroutine(LoadSeasonBootstrap());
        }

        private IEnumerator LoadSeasonBootstrap()
        {
            long started = UnixMs();
            using (var request = UnityWebRequest.Get(SeasonBootstrapEndpoint))
            {
                request.downloadHandler = new DownloadHandlerBuffer();
                request.SetRequestHeader("x-gf-season-secret", _config.SeasonApi.Secret);
                request.timeout = Math.Max(4, Mathf.CeilToInt(_config.SeasonApi.BootstrapTimeoutSeconds));
                yield return request.SendWebRequest();

                long code = request.responseCode;
                bool transportError = request.result == UnityWebRequest.Result.ConnectionError ||
                                      request.result == UnityWebRequest.Result.DataProcessingError;
                if (transportError || code < 200 || code >= 300)
                {
                    _seasonBootstrapLastError = transportError
                        ? (string.IsNullOrWhiteSpace(request.error) ? "erro de rede/timeout" : request.error)
                        : $"HTTP {code}";
                    _seasonBootstrapInFlight = false;
                    _seasonBootstrapCoroutine = null;
                    Puts($"Season DB: bootstrap falhou ({_seasonBootstrapLastError}); nova tentativa em 15s.");
                    yield break;
                }

                try
                {
                    JObject root = JObject.Parse(request.downloadHandler.text ?? "{}");
                    JObject season = root["season"] as JObject;
                    JArray players = root["players"] as JArray ?? new JArray();

                    var fresh = new Dictionary<ulong, PlayerSeasonData>();
                    foreach (JToken token in players)
                    {
                        JObject p = token as JObject;
                        if (p == null) continue;
                        ulong steamId;
                        if (!ulong.TryParse((string)p["steam_id"], out steamId) || steamId == 0) continue;

                        var pd = new PlayerSeasonData
                        {
                            SteamId = steamId,
                            Name = (string)p["player_name"] ?? steamId.ToString(),
                            Mmr = JDouble(p, "mmr", _config.StartingMMR),
                            PvpRaidMmr = JDouble(p, "pvp_raid_mmr"),
                            FarmMmr = JDouble(p, "farm_mmr"),
                            BuildingMmr = JDouble(p, "building_mmr"),
                            EventMmr = JDouble(p, "event_mmr"),
                            OtherMmr = JDouble(p, "other_mmr"),
                            Kills = JInt(p, "kills"), Deaths = JInt(p, "deaths"), HeadshotKills = JInt(p, "headshots"), Assists = JInt(p, "assists"),
                            Wood = JLong(p, "wood"), Stone = JLong(p, "stone"), MetalOre = JLong(p, "metal_ore"), SulfurOre = JLong(p, "sulfur_ore"), HqmOre = JLong(p, "hqm_ore"),
                            BuildWood = JInt(p, "build_wood"), BuildStone = JInt(p, "build_stone"), BuildMetal = JInt(p, "build_metal"), BuildArmored = JInt(p, "build_armored"),
                            RocketsUsed = JInt(p, "rockets_used"), C4Used = JInt(p, "c4_used"), SatchelsUsed = JInt(p, "satchels_used"),
                            RaidStructuresDestroyed = JInt(p, "raid_structures_destroyed"), TcsDestroyed = JInt(p, "tcs_destroyed"),
                            RaidsParticipated = JInt(p, "raids_participated"), RaidsDefended = JInt(p, "raids_defended"),
                            BradleyParticipations = JInt(p, "bradley_participations"), HeliParticipations = JInt(p, "heli_participations"), CratesHacked = JInt(p, "crates_hacked"),
                            LastSeenUnix = Now(), Ledger = new List<MmrTransaction>()
                        };

                        // Rebuild conservative diminishing-return state after reload.
                        // Exact MMR remains authoritative in PostgreSQL; this prevents reload abuse.
                        pd.PvpRaidPositiveEarned = Math.Max(0, pd.PvpRaidMmr);
                        pd.FarmPositiveEarned = Math.Max(0, pd.FarmMmr);
                        pd.BuildingPositiveEarned = Math.Max(0, pd.BuildingMmr);
                        pd.EventPositiveEarned = Math.Max(0, pd.EventMmr);
                        pd.OtherPositiveEarned = Math.Max(0, pd.OtherMmr);
                        fresh[steamId] = pd;
                    }

                    if (season != null)
                    {
                        _data.CurrentSeasonNumber = Math.Max(1, JInt(season, "season_number", 1));
                        _data.CurrentSeasonId = (string)season["season_id"] ?? BrazilNow().ToString("yyyy-MM");
                    }
                    else
                    {
                        _data.CurrentSeasonId = BrazilNow().ToString("yyyy-MM");
                        _data.CurrentSeasonNumber = Math.Max(1, _data.CurrentSeasonNumber);
                    }

                    _data.Players = fresh;

                    // The DB/API is authoritative. If bootstrap returned an active Season,
                    // scoring must stay enabled regardless of the local calendar/month.
                    // This preserves the V105 gameplay hooks exactly as they worked.
                    string backendStatus = season != null
                        ? (((string)season["status"] ?? "").Trim().ToLowerInvariant())
                        : "";
                    _seasonBackendStatus = string.IsNullOrEmpty(backendStatus) ? "sem-status" : backendStatus;

                    // A successful bootstrap with a concrete Season is enough to enable
                    // gameplay scoring. The API/database already chose the authoritative
                    // Season. Local calendar/status gates must never discard hooks before
                    // QueueSeasonApiEvent() is reached.
                    _data.SeasonActive = season != null;

                    foreach (var player in BasePlayer.activePlayerList)
                    {
                        EnsurePlayer(player.userID, player.displayName);
                        GetRuntime(player.userID);
                    }

                    _seasonStateReady = true;
                    _seasonBootstrapLastSuccessUnixMs = UnixMs();
                    _seasonBootstrapLastError = "";
                    Puts($"Season DB: bootstrap OK | Season {_data.CurrentSeasonNumber} ({_data.CurrentSeasonId}) | {_data.Players.Count} jogadores em RAM | {Math.Max(0, UnixMs()-started)}ms");
                }
                catch (Exception ex)
                {
                    _seasonBootstrapLastError = "JSON inválido: " + ex.Message;
                    Puts($"Season DB: bootstrap inválido ({ex.Message}); nova tentativa em 15s.");
                }
            }

            _seasonBootstrapInFlight = false;
            _seasonBootstrapCoroutine = null;
        }

        private double JDouble(JObject obj, string key, double fallback = 0)
        {
            JToken t = obj?[key];
            double v;
            return t != null && double.TryParse(t.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? v : fallback;
        }
        private int JInt(JObject obj, string key, int fallback = 0)
        {
            JToken t = obj?[key];
            int v;
            return t != null && int.TryParse(t.ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out v) ? v : fallback;
        }
        private long JLong(JObject obj, string key, long fallback = 0)
        {
            JToken t = obj?[key];
            long v;
            return t != null && long.TryParse(t.ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out v) ? v : fallback;
        }

        #endregion

        #region Railway Season API

        private void InitializeSeasonApiQueueInMemory()
        {
            _seasonApiQueueData = new SeasonApiQueueData
            {
                Jobs = new List<SeasonApiJob>()
            };
        }

        private string PlayerSnapshotJson(PlayerSeasonData p)
        {
            return "{" +
                "\"steam_id\":\"" + p.SteamId + "\"," +
                "\"player_name\":\"" + JsonEscape(p.Name) + "\"," +
                "\"mmr\":" + p.Mmr.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                "\"pvp_raid_mmr\":" + p.PvpRaidMmr.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                "\"farm_mmr\":" + p.FarmMmr.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                "\"building_mmr\":" + p.BuildingMmr.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                "\"event_mmr\":" + p.EventMmr.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                "\"other_mmr\":" + p.OtherMmr.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                "\"kills\":" + p.Kills + ",\"deaths\":" + p.Deaths + ",\"headshots\":" + p.HeadshotKills + ",\"assists\":" + p.Assists + "," +
                "\"wood\":" + p.Wood + ",\"stone\":" + p.Stone + ",\"metal_ore\":" + p.MetalOre + ",\"sulfur_ore\":" + p.SulfurOre + ",\"hqm_ore\":" + p.HqmOre + "," +
                "\"build_wood\":" + p.BuildWood + ",\"build_stone\":" + p.BuildStone + ",\"build_metal\":" + p.BuildMetal + ",\"build_armored\":" + p.BuildArmored + "," +
                "\"rockets_used\":" + p.RocketsUsed + ",\"c4_used\":" + p.C4Used + ",\"satchels_used\":" + p.SatchelsUsed + "," +
                "\"raid_structures_destroyed\":" + p.RaidStructuresDestroyed + ",\"tcs_destroyed\":" + p.TcsDestroyed + "," +
                "\"raids_participated\":" + p.RaidsParticipated + ",\"raids_defended\":" + p.RaidsDefended + "," +
                "\"bradley_participations\":" + p.BradleyParticipations + ",\"heli_participations\":" + p.HeliParticipations + ",\"crates_hacked\":" + p.CratesHacked +
                "}";
        }

        private void QueueSeasonApiEvent(PlayerSeasonData data, string category, string type,
            double baseValue, double multiplier, double finalValue, string details)
        {
            if (!_seasonStateReady) return;
            if (_config.SeasonApi == null || !_config.SeasonApi.Enabled || string.IsNullOrWhiteSpace(SeasonEventsEndpoint))
                return;

            string tx = Guid.NewGuid().ToString("N");
            string payload = "{\"events\":[{" +
                "\"transaction_id\":\"" + tx + "\"," +
                "\"season_number\":" + Math.Max(1, _data.CurrentSeasonNumber) + "," +
                "\"season_id\":\"" + JsonEscape(_data.CurrentSeasonId) + "\"," +
                "\"starting_mmr\":" + _config.StartingMMR.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                "\"category\":\"" + JsonEscape(category) + "\"," +
                "\"event_type\":\"" + JsonEscape(type) + "\"," +
                "\"base_value\":" + baseValue.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                "\"multiplier\":" + multiplier.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                "\"final_value\":" + finalValue.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                "\"details\":\"" + JsonEscape(details) + "\"," +
                "\"timestamp_unix\":" + Now() + "," +
                "\"player\":" + PlayerSnapshotJson(data) +
                "}]}";


            _seasonApiQueueData.Jobs.Add(new SeasonApiJob
            {
                Id = tx,
                Payload = payload,
                Attempts = 0,
                NextAttemptUnixMs = UnixMs()
            });

        }

        private void ProcessSeasonApiQueue()
        {
            if (_seasonApiRequestInFlight)
            {
                long hardTimeoutMs = (long)((Math.Max(2f, _config?.SeasonApi?.TimeoutSeconds ?? 8f) + 5f) * 1000f);
                if (_seasonApiRequestStartedUnixMs > 0 && UnixMs() - _seasonApiRequestStartedUnixMs > hardTimeoutMs)
                {
                    if (_seasonApiCoroutine != null && ServerMgr.Instance != null)
                        ServerMgr.Instance.StopCoroutine(_seasonApiCoroutine);
                    _seasonApiCoroutine = null;
                    _seasonApiRequestInFlight = false;
                    _seasonApiRequestStartedUnixMs = 0;
                    _seasonApiFailureCount++;
                    _seasonApiLastFailureUnixMs = UnixMs();
                    _seasonApiLastError = "watchdog: requisição automática excedeu o timeout";
                }
                else
                {
                    return;
                }
            }

            if (_config.SeasonApi == null || !_config.SeasonApi.Enabled)
                return;
            if (string.IsNullOrWhiteSpace(SeasonEventsEndpoint) || string.IsNullOrWhiteSpace(_config.SeasonApi.Secret))
                return;
            if (_seasonApiQueueData?.Jobs == null || _seasonApiQueueData.Jobs.Count == 0)
                return;

            long now = UnixMs();
            var first = _seasonApiQueueData.Jobs[0];
            if (first.NextAttemptUnixMs > now)
                return;

            int batchSize = Math.Max(1, Math.Min(_config.SeasonApi.BatchSize, _seasonApiQueueData.Jobs.Count));
            var batch = _seasonApiQueueData.Jobs.Take(batchSize).ToList();
            string payload = BuildSeasonApiBatchPayload(batch);

            _seasonApiRequestInFlight = true;
            _seasonApiRequestStartedUnixMs = UnixMs();
            _seasonApiCoroutine = ServerMgr.Instance.StartCoroutine(SendSeasonApiBatch(batch, payload));
        }

        private string BuildSeasonApiBatchPayload(List<SeasonApiJob> batch)
        {
            var sb = new StringBuilder();
            sb.Append("{\"events\":[");

            for (int i = 0; i < batch.Count; i++)
            {
                if (i > 0) sb.Append(',');
                string payload = batch[i].Payload ?? "";
                int open = payload.IndexOf('[');
                int close = payload.LastIndexOf(']');
                if (open >= 0 && close > open)
                    sb.Append(payload.Substring(open + 1, close - open - 1));
            }

            sb.Append("]}");
            return sb.ToString();
        }

        private IEnumerator SendSeasonApiBatch(List<SeasonApiJob> batch, string payload)
        {
            long started = UnixMs();
            using (var request = new UnityWebRequest(SeasonEventsEndpoint, "POST"))
            {
                byte[] body = Encoding.UTF8.GetBytes(payload);
                request.uploadHandler = new UploadHandlerRaw(body);
                request.downloadHandler = new DownloadHandlerBuffer();
                request.SetRequestHeader("Content-Type", "application/json");
                request.SetRequestHeader("x-gf-season-secret", _config.SeasonApi.Secret);
                request.timeout = Math.Max(2, Mathf.CeilToInt(_config.SeasonApi.TimeoutSeconds));

                yield return request.SendWebRequest();

                _seasonApiLastLatencyMs = Math.Max(0, UnixMs() - started);
                _seasonApiLastHttpCode = (int)request.responseCode;

                bool transportError = request.result == UnityWebRequest.Result.ConnectionError ||
                                      request.result == UnityWebRequest.Result.DataProcessingError;
                bool success = !transportError && request.responseCode >= 200 && request.responseCode < 300;

                if (success)
                {
                    _seasonApiSuccessCount += batch.Count;
                    _seasonApiLastSuccessUnixMs = UnixMs();
                    _seasonApiLastError = "";

                    // The backend intentionally returns HTTP 2xx even for events it
                    // classified as stale/rejected so one bad event cannot poison the
                    // queue. Read those counters explicitly: HTTP 200 alone is not
                    // treated as proof that every event was persisted.
                    try
                    {
                        string responseText = request.downloadHandler?.text ?? "";
                        if (!string.IsNullOrWhiteSpace(responseText))
                        {
                            JObject response = JObject.Parse(responseText);
                            _seasonApiBackendAcceptedCount += JLong(response, "accepted", 0);
                            _seasonApiBackendDuplicateCount += JLong(response, "duplicates", 0);
                            _seasonApiBackendRejectedCount += JLong(response, "rejected", 0);
                            _seasonApiBackendStaleCount += JLong(response, "stale", 0);
                            _seasonApiBackendRemappedCount += JLong(response, "remapped", 0);
                        }
                    }
                    catch (Exception ex)
                    {
                        // Transport succeeded; keep the queue flowing, but expose the
                        // diagnostic instead of silently pretending the body was valid.
                        _seasonApiLastError = "HTTP 2xx, resposta de ingestão não interpretada: " + ex.Message;
                    }

                    var ids = new HashSet<string>(batch.Select(x => x.Id));
                    _seasonApiQueueData.Jobs.RemoveAll(x => ids.Contains(x.Id));
                }
                else
                {
                    _seasonApiFailureCount++;
                    _seasonApiRetryCount += batch.Count;
                    _seasonApiLastFailureUnixMs = UnixMs();
                    _seasonApiLastError = transportError
                        ? (string.IsNullOrWhiteSpace(request.error) ? "erro de rede/timeout" : request.error)
                        : $"HTTP {request.responseCode}";

                    int maxAttempts = 0;
                    foreach (var job in batch)
                    {
                        job.Attempts++;
                        if (job.Attempts > maxAttempts) maxAttempts = job.Attempts;
                    }

                    double delay = Math.Min(_config.SeasonApi.MaxRetrySeconds,
                        _config.SeasonApi.RetryBaseSeconds * Math.Pow(2, Math.Min(Math.Max(0, maxAttempts - 1), 7)));
                    long retryAt = UnixMs() + (long)(Math.Max(1, delay) * 1000);
                    foreach (var job in batch)
                        job.NextAttemptUnixMs = retryAt;
                }
            }

            _seasonApiRequestInFlight = false;
            _seasonApiRequestStartedUnixMs = 0;
            _seasonApiCoroutine = null;
        }

        #endregion

        #region Discord Webhook Logs

        private void InitializeWebhookQueueInMemory()
        {
            _webhookQueueData = new WebhookQueueData
            {
                Jobs = new List<WebhookJob>()
            };
        }

        private void SendMmrWebhook(PlayerSeasonData data, string category, string type,
    double rawValue, double multiplier, double finalValue, string details)
        {
            // V096: canal webhook legado desativado de forma definitiva.
            // Eventos da Season são enviados somente por SeasonApi (/api/season/events).
            return;
            if (_config.Webhook == null || !_config.Webhook.Enabled || !_sendWebhook) return;
            if (string.IsNullOrWhiteSpace(_config.Webhook.Url)) return;
            if (Math.Abs(finalValue) < 0.000001 && !_config.Webhook.LogZeroValueEvents) return;

            // Apenas cria o objeto com os dados brutos, sem montar JSON aqui
            var job = new WebhookJob
            {
                Id = Guid.NewGuid().ToString("N"),
                SteamId = data.SteamId,
                PlayerName = data.Name,
                PlayerMmr = data.Mmr,
                Category = category,
                EventType = type,
                RawValue = rawValue,
                Multiplier = multiplier,
                FinalValue = finalValue,
                Details = details,
                CreatedUnixMs = UnixMs(),
                NextAttemptUnixMs = UnixMs(),
                Attempts = 0
            };

            _webhookQueueData.Jobs.Add(job);
        }

        private void ProcessWebhookQueue()
        {
            // V096: webhook legado removido. Nunca executa POST para URL configurável.
            return;
        }

        private string BuildWebhookPayload(WebhookJob job)
        {
            string sign = job.FinalValue > 0 ? "+" : "";
            string direction = job.FinalValue > 0 ? "GANHO" : job.FinalValue < 0 ? "PERDA" : "ZERO";
            int color = job.FinalValue > 0
                ? _config.Webhook.GainColor
                : job.FinalValue < 0
                    ? _config.Webhook.LossColor
                    : _config.Webhook.ZeroColor;

            string title = $"{direction} DE MMR • {job.PlayerName}";
            string description = $"**{sign}{job.FinalValue:0.###} MMR**  →  **{job.PlayerMmr:0.###} MMR**";

            //Sempre que for criar strings grandes e concatenar as linhas, utilize StringBuilder
            var sb = new StringBuilder();

            sb.Append('{');
            sb.Append("\"username\":\"").Append(JsonEscape(_config.Webhook.Username)).Append("\",");
            sb.Append("\"embeds\":[{");
            sb.Append("\"title\":\"").Append(JsonEscape(title)).Append("\",");
            sb.Append("\"description\":\"").Append(JsonEscape(description)).Append("\",");
            sb.Append("\"color\":").Append(color).Append(",");
            sb.Append("\"fields\":[");
            sb.Append(WebhookField("SteamID", job.SteamId.ToString(), true)).Append(",");
            sb.Append(WebhookField("Season", _data.CurrentSeasonId, true)).Append(",");
            sb.Append(WebhookField("Categoria", job.Category, true)).Append(",");
            sb.Append(WebhookField("Evento", job.EventType, true)).Append(",");
            sb.Append(WebhookField("Valor base", job.RawValue.ToString("0.###", CultureInfo.InvariantCulture), true)).Append(",");
            sb.Append(WebhookField("Multiplicador", job.Multiplier.ToString("0.###", CultureInfo.InvariantCulture) + "x", true)).Append(",");
            sb.Append(WebhookField("Detalhes", string.IsNullOrWhiteSpace(job.Details) ? "-" : job.Details, false));
            sb.Append("],");
            sb.Append("\"footer\":{\"text\":\"Guerra Fria • Season MMR • fila confiável\"},");
            sb.Append("\"timestamp\":\"").Append(DateTime.UtcNow.ToString("o")).Append("\"");
            sb.Append("}]}");

            return sb.ToString();
        }

        #endregion

        #region Multipliers / Gear

        private double GetWeaponBaseValue(string shortname)
        {
            if (string.IsNullOrWhiteSpace(shortname))
                return _config.Pvp.DefaultWeaponMMR;

            double value;

            if (_config.Pvp.WeaponMMR.TryGetValue(shortname, out value))
                return value;

            foreach (var entry in _config.Pvp.WeaponMMR)
                if (shortname.IndexOf(entry.Key, StringComparison.OrdinalIgnoreCase) >= 0)
                    return entry.Value;

            return _config.Pvp.DefaultWeaponMMR;
        }

        private double GetDeathWeaponMultiplier(string shortname)
        {
            if (string.IsNullOrWhiteSpace(shortname))
                return 1.0;

            double value;

            if (_config.Pvp.DeathWeaponMultipliers.TryGetValue(shortname, out value))
                return value;

            foreach (var entry in _config.Pvp.DeathWeaponMultipliers)
                if (shortname.IndexOf(entry.Key, StringComparison.OrdinalIgnoreCase) >= 0)
                    return entry.Value;

            return 1.0;
        }

        private double GetGearMultiplier(KillContext ctx)
        {
            double diff = ctx.VictimGearScore - ctx.AttackerGearScore;

            if (diff >= 150) return 1.50;
            if (diff >= 100) return 1.35;
            if (diff >= 50) return 1.18;

            if (diff <= -150) return 0.45;
            if (diff <= -100) return 0.60;
            if (diff <= -50) return 0.78;

            return 1.0;
        }

        private double GetMmrDifferenceMultiplier(KillContext ctx)
        {
            double diff = ctx.VictimMmr - ctx.AttackerMmr;

            if (diff >= 600) return 1.40;
            if (diff >= 300) return 1.25;
            if (diff >= 150) return 1.12;

            if (diff <= -600) return 0.65;
            if (diff <= -300) return 0.78;
            if (diff <= -150) return 0.90;

            return 1.0;
        }

        private double GetDistanceMultiplier(KillContext ctx)
        {
            if (IsPrimitiveWeapon(ctx.WeaponShortname))
            {
                if (ctx.Distance >= 120) return 1.30;
                if (ctx.Distance >= 80) return 1.18;
                if (ctx.Distance >= 50) return 1.10;
                return 1.0;
            }

            if (ctx.Distance >= 200) return 1.20;
            if (ctx.Distance >= 125) return 1.12;
            if (ctx.Distance >= 75) return 1.06;

            return 1.0;
        }

        private bool IsPrimitiveWeapon(string weapon)
        {
            if (string.IsNullOrEmpty(weapon)) return false;

            return weapon.Contains("bow") ||
                   weapon.Contains("crossbow") ||
                   weapon.Contains("spear") ||
                   weapon.Contains("rock") ||
                   weapon.Contains("nailgun") ||
                   weapon.Contains("eoka");
        }

        private float GetGearScore(BasePlayer player)
        {
            if (player?.inventory == null) return 0f;

            float score = 0f;
            score += SumContainerGear(player.inventory.containerWear);
            score += SumContainerGear(player.inventory.containerBelt);
            return score;
        }

        private float SumContainerGear(ItemContainer container)
        {
            if (container?.itemList == null) return 0f;

            float total = 0f;

            foreach (var item in container.itemList)
            {
                if (item?.info == null) continue;

                float value;
                if (_config.Gear.ItemScores.TryGetValue(item.info.shortname, out value))
                    total += value;
            }

            return total;
        }

        private bool HasMeaningfulWeapon(BasePlayer player)
        {
            if (player?.inventory?.containerBelt?.itemList == null)
                return false;

            foreach (var item in player.inventory.containerBelt.itemList)
            {
                if (item?.info == null) continue;

                if (_config.FreshSpawn.ProtectionBreakingWeapons.Contains(item.info.shortname))
                    return true;
            }

            return false;
        }

        #endregion

        #region Utility

        private bool SameTeam(BasePlayer a, BasePlayer b)
        {
            if (a == null || b == null) return false;
            if (a.currentTeam == 0 || b.currentTeam == 0) return false;
            return a.currentTeam == b.currentTeam;
        }

        private bool AreUsersSameTeam(ulong a, ulong b)
        {
            var pa = BasePlayer.FindByID(a) ?? BasePlayer.FindSleeping(a);
            var pb = BasePlayer.FindByID(b) ?? BasePlayer.FindSleeping(b);

            return pa != null && pb != null && SameTeam(pa, pb);
        }

        private string GetWeaponShortname(HitInfo info)
        {
            if (info == null) return "unknown";

            try
            {
                if (info.Weapon != null && !string.IsNullOrEmpty(info.Weapon.ShortPrefabName))
                    return info.Weapon.ShortPrefabName;
            }
            catch { }

            try
            {
                if (info.WeaponPrefab != null && !string.IsNullOrEmpty(info.WeaponPrefab.ShortPrefabName))
                    return info.WeaponPrefab.ShortPrefabName;
            }
            catch { }

            return "unknown";
        }

        private ulong GetNetId(BaseNetworkable entity)
        {
            if (entity?.net == null) return 0;

            try
            {
                return entity.net.ID.Value;
            }
            catch
            {
                return 0;
            }
        }

        private long Now() => DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        private long UnixMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        private string WebhookField(string name, string value, bool inline)
        {
            return "{\"name\":\"" + JsonEscape(name) + "\",\"value\":\"" + JsonEscape(value) + "\",\"inline\":" + (inline ? "true" : "false") + "}";
        }

        private string JsonEscape(string value)
        {
            if (string.IsNullOrEmpty(value)) return string.Empty;
            return value
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\r", "\\r")
                .Replace("\n", "\\n")
                .Replace("\t", "\\t");
        }

        #endregion

        #region Chat Commands

        [ChatCommand("season")]
        private void CmdSeason(BasePlayer player, string command, string[] args)
        {
            if (player == null) return;

            var data = EnsurePlayer(player.userID, player.displayName);

            if (args.Length == 0)
            {
                if (!_data.SeasonActive)
                {
                    DateTime localNow = BrazilNow();
                    DateTime opening = FirstThursday(localNow.Year, localNow.Month);
                    if (localNow >= opening) opening = FirstThursday(localNow.AddMonths(1).Year, localNow.AddMonths(1).Month);
                    int nextNumber = Math.Max(1, _data.CurrentSeasonNumber) + 1;
                    SendReply(player, $"<color=#ffd166>SEASON {nextNumber} VEM AÍ</color>\nA próxima Season começa em {opening:dd/MM/yyyy} (primeira quinta-feira do mês).\nA Season anterior já foi encerrada.");
                    return;
                }
                SendReply(player,
                    $"<color=#ffd166>SEASON {_data.CurrentSeasonId}</color>\n" +
                    $"MMR: <color=#ffffff>{data.Mmr:0.00}</color>\n" +
                    $"PvP+Raid: {data.PvpRaidMmr:0.00} | Farm: {data.FarmMmr:0.00}\n" +
                    $"Build: {data.BuildingMmr:0.00} | Eventos: {data.EventMmr:0.00}\n" +
                    $"Kills: {data.Kills} | Mortes: {data.Deaths} | HS Kills: {data.HeadshotKills}\n" +
                    $"Raids: {data.RaidsParticipated} | Defesas: {data.RaidsDefended}");
                return;
            }

            if (args[0].Equals("top", StringComparison.OrdinalIgnoreCase))
            {
                var top = _data.Players.Values.OrderByDescending(x => x.Mmr).Take(10).ToList();
                var lines = new List<string> { $"<color=#ffd166>TOP 10 — SEASON {_data.CurrentSeasonId}</color>" };

                for (int i = 0; i < top.Count; i++)
                    lines.Add($"{i + 1}. {top[i].Name} — {top[i].Mmr:0.00} MMR");

                SendReply(player, string.Join("\n", lines.ToArray()));
                return;
            }

            if (args[0].Equals("me", StringComparison.OrdinalIgnoreCase))
            {
                SendReply(player,
                    $"Farm: wood={data.Wood:N0}, stone={data.Stone:N0}, metal={data.MetalOre:N0}, sulfur={data.SulfurOre:N0}, HQM={data.HqmOre:N0}\n" +
                    $"Build: W={data.BuildWood}, S={data.BuildStone}, M={data.BuildMetal}, HQ={data.BuildArmored}\n" +
                    $"Eventos: Bradley={data.BradleyParticipations}, Heli={data.HeliParticipations}, Crates={data.CratesHacked}");
                return;
            }

            SendReply(player, "Use /season, /season top ou /season me");
        }

        #endregion

        #region Console/Admin Commands

        [ConsoleCommand("season.info")]
        private void CCmdInfo(ConsoleSystem.Arg arg)
        {
            if (!HasConsoleAccess(arg)) return;

            ulong userId;
            if (arg.Args == null || arg.Args.Length < 1 || !ulong.TryParse(arg.Args[0], out userId))
            {
                arg.ReplyWith("Uso: season.info <steamid>");
                return;
            }

            PlayerSeasonData data;
            if (!_data.Players.TryGetValue(userId, out data))
            {
                arg.ReplyWith("Jogador não encontrado.");
                return;
            }

            arg.ReplyWith(
                $"{data.Name} ({data.SteamId}) | MMR={data.Mmr:0.000} | " +
                $"PvP+Raid={data.PvpRaidMmr:0.000} | Farm={data.FarmMmr:0.000} | " +
                $"Build={data.BuildingMmr:0.000} | Events={data.EventMmr:0.000} | " +
                $"Kills={data.Kills} | Deaths={data.Deaths}");
        }

        [ConsoleCommand("season.addmmr")]
        private void CCmdAddMmr(ConsoleSystem.Arg arg)
        {
            if (!HasConsoleAccess(arg)) return;

            if (arg.Args == null || arg.Args.Length < 2)
            {
                arg.ReplyWith("Uso: season.addmmr <steamid> <valor>");
                return;
            }

            ulong userId;
            double value;

            if (!ulong.TryParse(arg.Args[0], out userId) ||
                !double.TryParse(arg.Args[1], NumberStyles.Any, CultureInfo.InvariantCulture, out value))
            {
                arg.ReplyWith("Parâmetros inválidos.");
                return;
            }

            var data = EnsurePlayer(userId);
            ApplyMmr(data, "OTHER", "ADMIN_ADJUST", value, "Ajuste administrativo");

            arg.ReplyWith($"Novo MMR: {data.Mmr:0.000}");
        }

        [ConsoleCommand("season.setmmr")]
        private void CCmdSetMmr(ConsoleSystem.Arg arg)
        {
            if (!HasConsoleAccess(arg)) return;

            if (arg.Args == null || arg.Args.Length < 2)
            {
                arg.ReplyWith("Uso: season.setmmr <steamid> <valor>");
                return;
            }

            ulong userId;
            double value;

            if (!ulong.TryParse(arg.Args[0], out userId) ||
                !double.TryParse(arg.Args[1], NumberStyles.Any, CultureInfo.InvariantCulture, out value))
            {
                arg.ReplyWith("Parâmetros inválidos.");
                return;
            }

            var data = EnsurePlayer(userId);
            double old = data.Mmr;
            data.Mmr = Math.Max(_config.MinimumMMR, value);

            double adminDelta = data.Mmr - old;
            AddLedger(data, "OTHER", "ADMIN_SET", old, 1, adminDelta, $"set={value}");
            QueueSeasonApiEvent(data, "OTHER", "ADMIN_SET", adminDelta, 1, adminDelta, $"MMR definido manualmente para {value:0.###}");
            SendMmrWebhook(data, "OTHER", "ADMIN_SET", adminDelta, 1, adminDelta, $"MMR definido manualmente para {value:0.###}");

            arg.ReplyWith($"MMR definido: {data.Mmr:0.000}");
        }

        [ConsoleCommand("season.resetplayer")]
        private void CCmdResetPlayer(ConsoleSystem.Arg arg)
        {
            if (!HasConsoleAccess(arg)) return;

            ulong userId;
            if (arg.Args == null || arg.Args.Length < 1 || !ulong.TryParse(arg.Args[0], out userId))
            {
                arg.ReplyWith("Uso: season.resetplayer <steamid>");
                return;
            }

            PlayerSeasonData existing;
            if (!_data.Players.TryGetValue(userId, out existing))
            {
                arg.ReplyWith("Jogador não encontrado.");
                return;
            }

            string name = existing.Name;
            _data.Players[userId] = new PlayerSeasonData
            {
                SteamId = userId,
                Name = name,
                Mmr = _config.StartingMMR,
                LastSeenUnix = Now()
            };

            arg.ReplyWith("Jogador resetado para o início da Season.");
        }

        [ConsoleCommand("season.forcenew")]
        private void CCmdForceNew(ConsoleSystem.Arg arg)
        {
            if (!HasConsoleAccess(arg)) return;

            string newId = arg.Args != null && arg.Args.Length > 0
                ? arg.Args[0].ToString()
                : DateTime.UtcNow.ToString("yyyy-MM") + "-manual-" + DateTime.UtcNow.ToString("ddHHmm");

            EndSeasonInternal(_data.CurrentSeasonId);
            _data.CurrentSeasonNumber = Math.Max(1, _data.CurrentSeasonNumber) + 1;
            StartSeasonInternal(newId);

            arg.ReplyWith("Nova Season iniciada: " + newId);
        }

        [ConsoleCommand("season.top")]
        private void CCmdTop(ConsoleSystem.Arg arg)
        {
            if (!HasConsoleAccess(arg)) return;

            var top = _data.Players.Values.OrderByDescending(x => x.Mmr).Take(20).ToList();
            arg.ReplyWith(string.Join("\n", top.Select((p, i) =>
                $"{i + 1}. {p.Name} [{p.SteamId}] = {p.Mmr:0.00}").ToArray()));
        }

        [ConsoleCommand("season.webhooktest")]
        private void CCmdWebhookTest(ConsoleSystem.Arg arg)
        {
            if (!HasConsoleAccess(arg)) return;
            arg.ReplyWith("Webhook legado desativado. A Season usa exclusivamente /api/season/*.");
        }

        [ConsoleCommand("season.webhookqueue")]
        private void CCmdWebhookQueue(ConsoleSystem.Arg arg)
        {
            if (!HasConsoleAccess(arg)) return;

            int pending = _webhookQueueData?.Jobs?.Count ?? 0;

            if (pending == 0)
            {
                arg.ReplyWith("Fila do webhook: 0 pendentes.");
                return;
            }

            var first = _webhookQueueData.Jobs[0];
            double wait = Math.Max(0, (first.NextAttemptUnixMs - UnixMs()) / 1000.0);

            arg.ReplyWith($"Fila do webhook: {pending} pendentes | tentativas do próximo: {first.Attempts} | próxima tentativa em {wait:0.0}s");
        }


        [ConsoleCommand("season.apiqueue")]
        private void CCmdSeasonApiQueue(ConsoleSystem.Arg arg)
        {
            if (!HasConsoleAccess(arg)) return;
            int pending = _seasonApiQueueData?.Jobs?.Count ?? 0;
            arg.ReplyWith($"Fila Railway Season: {pending} pendentes.");
        }

        [ConsoleCommand("season.apistatus")]
        private void CCmdSeasonApiStatus(ConsoleSystem.Arg arg)
        {
            if (!HasConsoleAccess(arg)) return;

            int pending = _seasonApiQueueData?.Jobs?.Count ?? 0;
            string configured = (_config.SeasonApi != null && _config.SeasonApi.Enabled &&
                                 !string.IsNullOrWhiteSpace(SeasonEventsEndpoint) &&
                                 !string.IsNullOrWhiteSpace(_config.SeasonApi.Secret)) ? "SIM" : "NÃO";
            string inFlight = _seasonApiRequestInFlight ? "SIM" : "NÃO";
            string maintenance = _seasonApiMaintenanceInFlight ? "SIM" : "NÃO";
            string lastHttp = _seasonApiLastHttpCode == 0 ? "nenhum" : _seasonApiLastHttpCode.ToString();
            string lastSuccess = _seasonApiLastSuccessUnixMs == 0 ? "nunca" : $"há {Math.Max(0, (UnixMs() - _seasonApiLastSuccessUnixMs) / 1000.0):0.0}s";
            string lastFailure = _seasonApiLastFailureUnixMs == 0 ? "nunca" : $"há {Math.Max(0, (UnixMs() - _seasonApiLastFailureUnixMs) / 1000.0):0.0}s";

            arg.ReplyWith(
                "=== STATUS API SEASON ===\n" +
                $"Configurada: {configured} | Fila automática em envio: {inFlight} | Teste/Sync: {maintenance}\n" +
                $"Pendentes: {pending}\n" +
                $"Eventos enviados em HTTP 2xx: {_seasonApiSuccessCount}\n" +
                $"Backend: aceitos={_seasonApiBackendAcceptedCount} | duplicados={_seasonApiBackendDuplicateCount} | rejeitados={_seasonApiBackendRejectedCount} | stale={_seasonApiBackendStaleCount} | remapeados={_seasonApiBackendRemappedCount}\n" +
                $"Falhas de requisição: {_seasonApiFailureCount} | Eventos em retry: {_seasonApiRetryCount}\n" +
                $"Último HTTP: {lastHttp} | Latência: {_seasonApiLastLatencyMs}ms\n" +
                $"Último sucesso: {lastSuccess} | Última falha: {lastFailure}\n" +
                $"Último erro: {(string.IsNullOrWhiteSpace(_seasonApiLastError) ? "nenhum" : _seasonApiLastError)}\n" +
                $"SeasonActive: {(_data != null && _data.SeasonActive ? "SIM" : "NÃO")} | Status backend: {_seasonBackendStatus} | Season: {_data?.CurrentSeasonNumber} ({_data?.CurrentSeasonId})\n" +
                $"Estado RAM carregado do DB: {(_seasonStateReady ? "SIM" : "NÃO")}\n" +
                $"Bootstrap: {(_seasonBootstrapInFlight ? "EM ANDAMENTO" : (_seasonStateReady ? "OK" : "AGUARDANDO"))}\n" +
                $"Erro bootstrap: {(string.IsNullOrWhiteSpace(_seasonBootstrapLastError) ? "nenhum" : _seasonBootstrapLastError)}"
            );
        }

        [ConsoleCommand("season.apitest")]
        private void CCmdSeasonApiTest(ConsoleSystem.Arg arg)
        {
            if (!HasConsoleAccess(arg)) return;
            if (_config.SeasonApi == null || !_config.SeasonApi.Enabled ||
                string.IsNullOrWhiteSpace(SeasonPingEndpoint) || string.IsNullOrWhiteSpace(_config.SeasonApi.Secret))
            {
                arg.ReplyWith("TESTE API: configuração incompleta.");
                return;
            }
            if (_seasonApiMaintenanceInFlight)
            {
                arg.ReplyWith("TESTE API: já existe um teste/sync manual em andamento.");
                return;
            }
            _seasonApiMaintenanceInFlight = true;
            _seasonApiMaintenanceCoroutine = ServerMgr.Instance.StartCoroutine(SendSeasonApiPing(arg));
        }

        private IEnumerator SendSeasonApiPing(ConsoleSystem.Arg arg)
        {
            long started = UnixMs();
            using (var request = UnityWebRequest.Get(SeasonPingEndpoint))
            {
                request.downloadHandler = new DownloadHandlerBuffer();
                request.SetRequestHeader("x-gf-season-secret", _config.SeasonApi.Secret);
                request.timeout = Math.Max(3, Mathf.CeilToInt(_config.SeasonApi.TimeoutSeconds));
                yield return request.SendWebRequest();
                long code = request.responseCode;
                long elapsed = Math.Max(0, UnixMs() - started);
                bool ok = request.result != UnityWebRequest.Result.ConnectionError &&
                          request.result != UnityWebRequest.Result.DataProcessingError &&
                          code >= 200 && code < 300;
                if (ok)
                {
                    _seasonApiLastHttpCode = (int)code;
                    _seasonApiLastLatencyMs = elapsed;
                    _seasonApiLastSuccessUnixMs = UnixMs();
                    _seasonApiLastError = "";
                    arg.ReplyWith($"TESTE API: SUCESSO | HTTP {code} | banco OK | {elapsed}ms");
                }
                else
                {
                    _seasonApiFailureCount++;
                    _seasonApiLastFailureUnixMs = UnixMs();
                    _seasonApiLastError = code > 0 ? $"HTTP {code}" : (request.error ?? "sem resposta");
                    arg.ReplyWith($"TESTE API: FALHOU | {_seasonApiLastError} | {elapsed}ms");
                }
            }
            _seasonApiMaintenanceInFlight = false;
            _seasonApiMaintenanceCoroutine = null;
        }

        [ConsoleCommand("season.syncall")]
        private void CCmdSeasonSyncAll(ConsoleSystem.Arg arg)
        {
            if (!HasConsoleAccess(arg)) return;

            if (_config.SeasonApi == null || !_config.SeasonApi.Enabled ||
                string.IsNullOrWhiteSpace(SeasonSnapshotEndpoint) ||
                string.IsNullOrWhiteSpace(_config.SeasonApi.Secret))
            {
                arg.ReplyWith("Season API está desativada ou incompleta no config.");
                return;
            }

            if (_seasonApiMaintenanceInFlight)
            {
                arg.ReplyWith("SYNC API: já existe um teste/sync manual em andamento.");
                return;
            }

            if (!_seasonStateReady)
            {
                arg.ReplyWith("SYNC API: estado ainda não carregou do banco. Aguarde o bootstrap.");
                return;
            }

            int count = _data?.Players?.Count ?? 0;
            if (count <= 0)
            {
                arg.ReplyWith("SYNC API: nenhum jogador disponível para sincronizar.");
                return;
            }

            var players = _data.Players.Values.ToList();
            _seasonApiMaintenanceInFlight = true;
            _seasonApiMaintenanceCoroutine = ServerMgr.Instance.StartCoroutine(SendSeasonSnapshotChunks(arg, players));
            int chunks = (int)Math.Ceiling(count / 500.0);
            arg.ReplyWith($"SYNC API: enviando {count} jogadores em {chunks} lote(s) de até 500...");
        }

        private string BuildSeasonSnapshotPayload(IEnumerable<PlayerSeasonData> players)
        {
            var sb = new StringBuilder();
            sb.Append("{\"season_number\":").Append(Math.Max(1, _data.CurrentSeasonNumber));
            sb.Append(",\"season_id\":\"").Append(JsonEscape(_data.CurrentSeasonId)).Append("\"");
            sb.Append(",\"starting_mmr\":").Append(_config.StartingMMR.ToString("0.###", CultureInfo.InvariantCulture));
            sb.Append(",\"players\":[");

            bool first = true;
            foreach (var playerData in players)
            {
                if (!first) sb.Append(',');
                first = false;
                sb.Append(PlayerSnapshotJson(playerData));
            }

            sb.Append("]}");
            return sb.ToString();
        }

        private IEnumerator SendSeasonSnapshotChunks(ConsoleSystem.Arg arg, List<PlayerSeasonData> players)
        {
            int total = players.Count;
            int sent = 0;
            long wholeStarted = UnixMs();
            const int chunkSize = 500;

            for (int offset = 0; offset < total; offset += chunkSize)
            {
                var chunk = players.Skip(offset).Take(chunkSize).ToList();
                string payload = BuildSeasonSnapshotPayload(chunk);
                long started = UnixMs();

                using (var request = new UnityWebRequest(SeasonSnapshotEndpoint, "POST"))
                {
                    request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(payload));
                    request.downloadHandler = new DownloadHandlerBuffer();
                    request.SetRequestHeader("Content-Type", "application/json");
                    request.SetRequestHeader("x-gf-season-secret", _config.SeasonApi.Secret);
                    request.timeout = Math.Max(5, Mathf.CeilToInt(_config.SeasonApi.SnapshotTimeoutSeconds));
                    yield return request.SendWebRequest();

                    long elapsed = Math.Max(0, UnixMs() - started);
                    long code = request.responseCode;
                    _seasonApiLastLatencyMs = elapsed;
                    _seasonApiLastHttpCode = (int)code;

                    bool transportError = request.result == UnityWebRequest.Result.ConnectionError ||
                                          request.result == UnityWebRequest.Result.DataProcessingError;
                    bool success = !transportError && code >= 200 && code < 300;

                    if (!success)
                    {
                        _seasonApiFailureCount++;
                        _seasonApiLastFailureUnixMs = UnixMs();
                        _seasonApiLastError = transportError
                            ? (string.IsNullOrWhiteSpace(request.error) ? "erro de rede/timeout" : request.error)
                            : $"HTTP {code}";
                        arg.ReplyWith($"SYNC API: FALHOU no lote {offset / chunkSize + 1} | HTTP {(code == 0 ? "sem resposta" : code.ToString())} | {_seasonApiLastError}");
                        _seasonApiMaintenanceInFlight = false;
                        _seasonApiMaintenanceCoroutine = null;
                        yield break;
                    }

                    sent += chunk.Count;
                    _seasonApiSuccessCount += chunk.Count;
                    _seasonApiLastSuccessUnixMs = UnixMs();
                    _seasonApiLastError = "";
                }
            }

            arg.ReplyWith($"SYNC API: SUCESSO | {sent}/{total} jogadores | {Math.Max(0, UnixMs() - wholeStarted)}ms");
            _seasonApiMaintenanceInFlight = false;
            _seasonApiMaintenanceCoroutine = null;
        }

        [ConsoleCommand("season.apiunlock")]
        private void CCmdSeasonApiUnlock(ConsoleSystem.Arg arg)
        {
            if (!HasConsoleAccess(arg)) return;

            if (_seasonApiCoroutine != null && ServerMgr.Instance != null)
                ServerMgr.Instance.StopCoroutine(_seasonApiCoroutine);
            if (_seasonApiMaintenanceCoroutine != null && ServerMgr.Instance != null)
                ServerMgr.Instance.StopCoroutine(_seasonApiMaintenanceCoroutine);

            _seasonApiCoroutine = null;
            _seasonApiMaintenanceCoroutine = null;
            _seasonApiRequestInFlight = false;
            _seasonApiMaintenanceInFlight = false;
            _seasonApiRequestStartedUnixMs = 0;
            arg.ReplyWith("Season API: locks de requisição liberados. Nenhum dado em disco foi alterado.");
        }

        [ConsoleCommand("season.resetwebhookqueue")]
        private void CCmdResetWebhookQueue(ConsoleSystem.Arg arg)
        {
            if (!HasConsoleAccess(arg)) return;

            if (_webhookQueueData == null || _webhookQueueData.Jobs == null || _webhookQueueData.Jobs.Count == 0)
            {
                arg.ReplyWith("A fila do webhook já está vazia ou não foi inicializada.");
                return;
            }

            int pendingCount = _webhookQueueData.Jobs.Count;

            // Limpa a fila
            _webhookQueueData.Jobs.Clear();

            // Fila em memória: nada é gravado em disco.

            arg.ReplyWith($"Fila do webhook resetada com sucesso. {pendingCount} itens pendentes foram deletados definitivamente.");
        }
        [ConsoleCommand("season.disablewebhook")]
        private void CCmdDisableWebhook(ConsoleSystem.Arg arg)
        {
            if (!HasConsoleAccess(arg)) return;

            if (_config.Webhook == null || !_config.Webhook.Enabled || !_sendWebhook)
            {
                arg.ReplyWith("Webhook já está desativado no config.");
                return;
            }

            _config.Webhook.Enabled = false;
            SaveConfig();
            _sendWebhook = false;

            arg.ReplyWith("Webhook desativado com sucesso. Alteração salva no config.");
        }

        private bool HasConsoleAccess(ConsoleSystem.Arg arg)
        {
            if (arg.Connection == null) return true;

            var player = arg.Player();
            if (player == null) return false;

            return player.IsAdmin || permission.UserHasPermission(player.UserIDString, "seasonmmr.admin");
        }

        #endregion

        #region Models

        private class RuntimePlayerState
        {
            public long LastRespawnUnix;
            public long LastPvpAttackUnix;
            public bool AggressiveSinceRespawn;
        }

        private class StoredData
        {
            public string CurrentSeasonId = "";
            public int CurrentSeasonNumber = 1;
            public bool SeasonActive = true;
            public Dictionary<ulong, PlayerSeasonData> Players = new Dictionary<ulong, PlayerSeasonData>();
            public List<SeasonArchive> Archives = new List<SeasonArchive>();
        }

        private class PlayerSeasonData
        {
            public ulong SteamId;
            public string Name = "";
            public double Mmr = 1000;

            public double PvpRaidMmr;
            public double FarmMmr;
            public double BuildingMmr;
            public double EventMmr;
            public double OtherMmr;

            public double PvpRaidPositiveEarned;
            public double FarmPositiveEarned;
            public double BuildingPositiveEarned;
            public double EventPositiveEarned;
            public double OtherPositiveEarned;

            public int Kills;
            public int Deaths;
            public int HeadshotKills;
            public int Assists;

            public long Wood;
            public long Stone;
            public long MetalOre;
            public long SulfurOre;
            public long HqmOre;

            public int BuildWood;
            public int BuildStone;
            public int BuildMetal;
            public int BuildArmored;

            public int RocketsUsed;
            public int C4Used;
            public int SatchelsUsed;
            public int RaidStructuresDestroyed;
            public int TcsDestroyed;
            public int RaidsParticipated;
            public int RaidsDefended;

            public int BradleyParticipations;
            public int HeliParticipations;
            public int CratesHacked;

            public long LastSeenUnix;
            public long LastRespawnUnix;

            public List<MmrTransaction> Ledger = new List<MmrTransaction>();
        }

        private class MmrTransaction
        {
            public long TimestampUnix;
            public string Category;
            public string Type;
            public double BaseValue;
            public double Multiplier;
            public double FinalValue;
            public double ResultingMmr;
            public string Details;
        }

        private class KillContext
        {
            public ulong AttackerId;
            public ulong VictimId;
            public string AttackerName;
            public string VictimName;
            public string WeaponShortname;
            public bool Headshot;
            public bool VictimNaked;
            public float Distance;
            public double AttackerMmr;
            public double VictimMmr;
            public float AttackerGearScore;
            public float VictimGearScore;
            public int RepeatedKills;
            public double BaseWeaponValue;
            public double GearMultiplier;
            public double MmrMultiplier;
            public double HeadshotMultiplier;
            public double DistanceMultiplier;
            public double RepeatMultiplier;
            public double NakedMultiplier;
            public double FinalKillMultiplier;
        }

        private class RaidSession
        {
            public string Id;
            public ulong TargetOwnerId;
            public Vector3 Center;
            public HashSet<ulong> Attackers = new HashSet<ulong>();
            public HashSet<ulong> Defenders = new HashSet<ulong>();
            public int Rockets;
            public int C4;
            public int Satchels;
            public int StructuresDestroyed;
            public int AttackerPvpKills;
            public int DefenderPvpKills;
            public bool TcDestroyed;
            public double LastScoreMultiplier = 1.0;
            public long StartedUnix;
            public long LastActivityUnix;
        }

        private class EventDamageSession
        {
            public ulong EntityNetId;
            public string Type;
            public Dictionary<ulong, float> DamageByPlayer = new Dictionary<ulong, float>();
            public long LastActivityUnix;
        }

        private class SeasonArchive
        {
            public string SeasonId;
            public long EndedUnix;
            public List<PlayerSummary> Top = new List<PlayerSummary>();
        }

        private class PlayerSummary
        {
            public ulong SteamId;
            public string Name;
            public double Mmr;
            public double PvpRaidMmr;
            public double FarmMmr;
            public double BuildingMmr;
            public double EventMmr;
            public double OtherMmr;
            public int Kills;
            public int Deaths;
        }

        #endregion

        #region Config Models

        private class PluginConfig
        {
            public double StartingMMR = 1000;
            public double MinimumMMR = 0;
            public float SaveIntervalSeconds = 60;
            public int MaxLedgerEntriesPerPlayer = 1000;
            public int ArchiveTopPlayers = 100;
            public int MaxArchivedSeasons = 12;

            public WeightConfig Weights = new WeightConfig();
            public BalanceConfig Balance = new BalanceConfig();
            public FreshSpawnConfig FreshSpawn = new FreshSpawnConfig();
            public AntiFarmConfig AntiFarm = new AntiFarmConfig();
            public PvpConfig Pvp = new PvpConfig();
            public FarmConfig Farm = new FarmConfig();
            public BuildingConfig Building = new BuildingConfig();
            public RaidConfig Raid = new RaidConfig();
            public EventConfig Events = new EventConfig();
            public NpcAnimalConfig NpcAnimals = new NpcAnimalConfig();
            public GearConfig Gear = new GearConfig();
            public WebhookConfig Webhook = new WebhookConfig();
            public SeasonApiConfig SeasonApi = new SeasonApiConfig();

            public static PluginConfig CreateDefault()
            {
                var cfg = new PluginConfig();
                cfg.Normalize();
                return cfg;
            }

            public void Normalize()
            {
                if (Weights == null) Weights = new WeightConfig();
                if (Balance == null) Balance = new BalanceConfig();
                if (FreshSpawn == null) FreshSpawn = new FreshSpawnConfig();
                if (AntiFarm == null) AntiFarm = new AntiFarmConfig();
                if (Pvp == null) Pvp = new PvpConfig();
                if (Farm == null) Farm = new FarmConfig();
                if (Building == null) Building = new BuildingConfig();
                if (Raid == null) Raid = new RaidConfig();
                if (Events == null) Events = new EventConfig();
                if (Gear == null) Gear = new GearConfig();
                if (Webhook == null) Webhook = new WebhookConfig();
                if (SeasonApi == null) SeasonApi = new SeasonApiConfig();
                // URL legada configurável é neutralizada; a Season usa somente /api/season/*.
                Webhook.Enabled = false;
                Webhook.Url = string.Empty;
                // Endpoints are normalized to the dedicated Season API only.
                SeasonApi.EventsUrl = GuerraFriaSeasonV117.SeasonEventsEndpoint;
                SeasonApi.SnapshotUrl = GuerraFriaSeasonV117.SeasonSnapshotEndpoint;
                SeasonApi.BootstrapUrl = GuerraFriaSeasonV117.SeasonBootstrapEndpoint;
                SeasonApi.PingUrl = GuerraFriaSeasonV117.SeasonPingEndpoint;
                // Force the fast transport profile even when an older config file exists.
                // The backend accepts up to 250 events per request.
                SeasonApi.SendIntervalSeconds = 0.75f;
                SeasonApi.BatchSize = 250;

                if (Pvp.WeaponMMR == null) Pvp.WeaponMMR = PvpConfig.DefaultWeapons();
                if (Pvp.DeathWeaponMultipliers == null) Pvp.DeathWeaponMultipliers = PvpConfig.DefaultDeathMultipliers();
                if (Gear.ItemScores == null) Gear.ItemScores = GearConfig.DefaultScores();
                if (Building.DeployableMMR == null) Building.DeployableMMR = BuildingConfig.DefaultDeployables();
                if (FreshSpawn.ProtectionBreakingWeapons == null) FreshSpawn.ProtectionBreakingWeapons = FreshSpawnConfig.DefaultBreakingWeapons();

                if (AntiFarm.RepeatedKillMultipliers == null || AntiFarm.RepeatedKillMultipliers.Count == 0)
                    AntiFarm.RepeatedKillMultipliers = new List<double> { 1.0, 0.70, 0.40, 0.20, 0.05, 0.0 };
            }
        }

        private class WeightConfig
        {
            public double PvpRaidPercent = 35;
            public double FarmPercent = 35;
            public double BuildingPercent = 15;
            public double EventsPercent = 10;
            public double OtherPercent = 5;
        }

        private class BalanceConfig
        {
            // Same cap = same long-term economic importance.
            public double PvpRaidSoftCap = 600;
            public double FarmSoftCap = 600;
            public double BuildingSoftCap = 257;
            public double EventsSoftCap = 171;
            public double OtherSoftCap = 86;
            public double MinimumDiminishingMultiplier = 0.25;
        }

        private class FreshSpawnConfig
        {
            public bool Enabled = true;
            public int ProtectionSeconds = 180;
            public bool CancelWhenAttacking = true;
            public float MaxProtectedGearScore = 30;
            public HashSet<string> ProtectionBreakingWeapons = DefaultBreakingWeapons();

            public static HashSet<string> DefaultBreakingWeapons()
            {
                return new HashSet<string>
                {
                    "rifle.ak", "rifle.lr300", "rifle.bolt", "rifle.l96", "rifle.semiauto",
                    "smg.thompson", "smg.2", "smg.mp5",
                    "pistol.semiauto", "pistol.python", "pistol.revolver",
                    "shotgun.pump", "shotgun.spas12", "shotgun.double", "shotgun.waterpipe",
                    "lmg.m249"
                };
            }
        }

        private class AntiFarmConfig
        {
            public int RepeatKillWindowSeconds = 1800;
            public List<double> RepeatedKillMultipliers = new List<double>
            {
                1.00, 0.70, 0.40, 0.20, 0.05, 0.00
            };
        }

        private class PvpConfig
        {
            public double DefaultWeaponMMR = 1.0;
            public double MinimumKillMMR = 0.05;
            public bool DeathPenaltyEnabled = true;
            public double BaseDeathPenalty = 1.00;
            public double MinimumDeathPenalty = 0.25;
            public double MaximumDeathPenalty = 6.00;
            public double HeadshotMultiplier = 1.25;

            public float NakedGearScore = 12;
            public double NakedKillMultiplier = 0.00;

            public Dictionary<string, double> WeaponMMR = DefaultWeapons();
            public Dictionary<string, double> DeathWeaponMultipliers = DefaultDeathMultipliers();

            public static Dictionary<string, double> DefaultWeapons()
            {
                return new Dictionary<string, double>
                {
                    ["rock"] = 2.80,
                    ["spear.wooden"] = 2.60,
                    ["spear.stone"] = 2.70,
                    ["bow.hunting"] = 2.30,
                    ["bow.compound"] = 2.15,
                    ["crossbow"] = 2.00,
                    ["pistol.nailgun"] = 2.00,
                    ["pistol.eoka"] = 2.10,
                    ["pistol.revolver"] = 1.70,
                    ["pistol.python"] = 1.60,
                    ["pistol.semiauto"] = 1.50,
                    ["shotgun.double"] = 1.55,
                    ["shotgun.waterpipe"] = 1.65,
                    ["shotgun.pump"] = 1.35,
                    ["smg.thompson"] = 1.30,
                    ["smg.2"] = 1.25,
                    ["smg.mp5"] = 1.20,
                    ["rifle.semiauto"] = 1.30,
                    ["rifle.ak"] = 1.00,
                    ["rifle.lr300"] = 0.95,
                    ["rifle.bolt"] = 1.20,
                    ["rifle.l96"] = 1.10,
                    ["lmg.m249"] = 0.80
                };
            }

            public static Dictionary<string, double> DefaultDeathMultipliers()
            {
                return new Dictionary<string, double>
                {
                    ["rock"] = 2.00,
                    ["spear.wooden"] = 1.90,
                    ["spear.stone"] = 1.90,
                    ["bow.hunting"] = 1.70,
                    ["bow.compound"] = 1.60,
                    ["crossbow"] = 1.50,
                    ["pistol.nailgun"] = 1.45,
                    ["pistol.eoka"] = 1.50,
                    ["pistol.revolver"] = 1.25,
                    ["pistol.python"] = 1.20,
                    ["pistol.semiauto"] = 1.15,
                    ["smg.thompson"] = 1.00,
                    ["smg.2"] = 0.95,
                    ["smg.mp5"] = 0.90,
                    ["rifle.semiauto"] = 1.00,
                    ["rifle.ak"] = 0.80,
                    ["rifle.lr300"] = 0.78,
                    ["lmg.m249"] = 0.65
                };
            }
        }

        private class FarmConfig
        {
            public double WoodPer1000 = 0.08;
            public double StonePer1000 = 0.10;
            public double MetalPer1000 = 0.16;
            public double SulfurPer1000 = 0.22;
            public double HqmPer1000 = 0.60;
        }

        private class BuildingConfig
        {
            public double WoodUpgradeMMR = 0.010;
            public double StoneUpgradeMMR = 0.025;
            public double MetalUpgradeMMR = 0.060;
            public double ArmoredUpgradeMMR = 0.120;

            public bool AllowTeamOwnedUpgrades = false;
            public bool TrackDeployables = true;

            public Dictionary<string, double> DeployableMMR = DefaultDeployables();

            public static Dictionary<string, double> DefaultDeployables()
            {
                return new Dictionary<string, double>
                {
                    ["cupboard.tool.deployed"] = 0.12,
                    ["workbench1.deployed"] = 0.10,
                    ["workbench2.deployed"] = 0.25,
                    ["workbench3.deployed"] = 0.55
                };
            }
        }

        private class RaidConfig
        {
            public int SessionTimeoutSeconds = 600;
            public float PvpAttributionRadius = 100f;

            // Online defenders authorized on the TC.
            public double OfflinePayoutMultiplier = 0.20;
            public double PartialOnlinePayoutMultiplier = 0.50;
            public double FullOnlinePayoutMultiplier = 1.00;

            // Victim MMR scaling: 1000 = 1.00x; each 250 MMR changes payout by 10%, capped at 0.50x..2.00x.
            public double VictimMmrNeutralPoint = 1000;
            public double VictimMmrStep = 250;
            public double VictimMmrMultiplierPerStep = 0.10;
            public double VictimMmrMinMultiplier = 0.50;
            public double VictimMmrMaxMultiplier = 2.00;

            public double RocketUsefulHitMMR = 0.10;
            public double C4UsefulHitMMR = 0.20;
            public double SatchelUsefulHitMMR = 0.06;
            public double ExplosiveAmmoUsefulHitMMR = 0.006;

            public double DestroyWoodStructureMMR = 0.08;
            public double DestroyStoneStructureMMR = 0.20;
            public double DestroyMetalStructureMMR = 0.32;
            public double DestroyArmoredStructureMMR = 0.50;

            public double DestroyWoodDoorMMR = 0.05;
            public double DestroyMetalDoorMMR = 0.18;
            public double DestroyGarageDoorMMR = 0.28;
            public double DestroyArmoredDoorMMR = 0.42;
            public double DestroyOtherRaidEntityMMR = 0.03;

            public double TcEntityBaseMMR = 0.30;
            public double TcDestroyedBonus = 1.20;

            public double CompletedRaidParticipationMMR = 0.70;
            public double CompletedRaidTcBonus = 1.30;
            public double DefenseSuccessMMR = 1.20;

            public double PvpKillSessionBonus = 0.15;
            public double MaxPvpRaidSessionBonus = 1.50;
        }

        private class EventConfig
        {
            public double BradleyMMRPool = 4.0;
            public double PatrolHeliMMRPool = 5.0;
            public double LockedCrateHackMMR = 0.60;
            public float MinimumDamageShare = 0.05f;
        }


        private class NpcAnimalConfig
        {
            // Small values: NPC/animal farming must never dominate Events/PvP.
            public double ScientistKillMMR = 0.12;
            public double HeavyScientistKillMMR = 0.28;
            public double MurdererKillMMR = 0.10;
            public double OtherNpcKillMMR = 0.08;

            public double BearKillMMR = 0.12;
            public double PolarBearKillMMR = 0.14;
            public double WolfKillMMR = 0.07;
            public double BoarKillMMR = 0.04;
            public double StagKillMMR = 0.03;
            public double OtherAnimalKillMMR = 0.02;

            public double NpcDeathPenalty = 0.18;
            public double HeavyScientistDeathPenalty = 0.30;
            public double AnimalDeathPenalty = 0.12;
            public double BearDeathPenalty = 0.24;
            public double WolfDeathPenalty = 0.16;
        }

        private class SeasonApiConfig
        {
            public bool Enabled = true;
            public string EventsUrl = GuerraFriaSeasonV117.SeasonEventsEndpoint;
            public string SnapshotUrl = GuerraFriaSeasonV117.SeasonSnapshotEndpoint;
            public string BootstrapUrl = GuerraFriaSeasonV117.SeasonBootstrapEndpoint;
            public string PingUrl = GuerraFriaSeasonV117.SeasonPingEndpoint;
            public string Secret = "";
            public float SendIntervalSeconds = 0.75f;
            public int BatchSize = 250;
            public float TimeoutSeconds = 10f;
            public float SnapshotTimeoutSeconds = 15f;
            public float BootstrapTimeoutSeconds = 12f;
            public float RetryBaseSeconds = 3f;
            public float MaxRetrySeconds = 300f;
        }

        private class SeasonApiQueueData
        {
            public List<SeasonApiJob> Jobs = new List<SeasonApiJob>();
        }

        private class SeasonApiJob
        {
            public string Id;
            public string Payload;
            public int Attempts;
            public long NextAttemptUnixMs;
        }

        private class WebhookConfig
        {
            public bool Enabled = false;
            public string Url = "";
            public string Username = "Guerra Fria • Season MMR";

            // Discord decimal colors
            public int GainColor = 5763719;
            public int LossColor = 15548997;
            public int ZeroColor = 9807270;

            public bool LogZeroValueEvents = false;
            public float TimeoutSeconds = 10f;

            // Durable queue / Discord rate-limit control
            public float SendIntervalSeconds = 0.55f;
            public float RateLimitRetrySeconds = 1.0f;
            public float FailureRetryBaseSeconds = 5.0f;
            public float MaxFailureRetrySeconds = 300.0f;
        }

        private class WebhookQueueData
        {
            public List<WebhookJob> Jobs = new List<WebhookJob>();
        }

        private class WebhookJob
        {
            public string Id;

            // Dados originais do evento
            public ulong SteamId;
            public string PlayerName;
            public double PlayerMmr;
            public string Category;
            public string EventType;
            public double RawValue;
            public double Multiplier;
            public double FinalValue;
            public string Details;

            public long CreatedUnixMs;
            public long NextAttemptUnixMs;
            public int Attempts;
        }

        private class GearConfig
        {
            public Dictionary<string, float> ItemScores = DefaultScores();

            public static Dictionary<string, float> DefaultScores()
            {
                return new Dictionary<string, float>
                {
                    ["rock"] = 2,
                    ["spear.wooden"] = 5,
                    ["spear.stone"] = 6,
                    ["bow.hunting"] = 10,
                    ["bow.compound"] = 13,
                    ["crossbow"] = 15,
                    ["pistol.nailgun"] = 15,
                    ["pistol.eoka"] = 13,
                    ["pistol.revolver"] = 22,
                    ["pistol.semiauto"] = 28,
                    ["pistol.python"] = 30,
                    ["shotgun.double"] = 28,
                    ["shotgun.pump"] = 35,
                    ["smg.thompson"] = 40,
                    ["smg.2"] = 40,
                    ["smg.mp5"] = 48,
                    ["rifle.semiauto"] = 45,
                    ["rifle.ak"] = 65,
                    ["rifle.lr300"] = 65,
                    ["rifle.bolt"] = 60,
                    ["rifle.l96"] = 70,
                    ["lmg.m249"] = 80,

                    ["hazmatsuit"] = 25,
                    ["hoodie"] = 5,
                    ["pants"] = 5,
                    ["shoes.boots"] = 4,
                    ["wood.armor.jacket"] = 8,
                    ["wood.armor.pants"] = 7,
                    ["roadsign.jacket"] = 18,
                    ["roadsign.kilt"] = 18,
                    ["metal.facemask"] = 28,
                    ["metal.plate.torso"] = 32
                };
            }
        }

        #endregion
    }
}
