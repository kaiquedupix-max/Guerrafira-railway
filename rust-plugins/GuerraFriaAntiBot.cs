using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("GuerraFriaAntiBot", "Maciota", "1.1.0")]
    [Description("Protecao L7 contra connection flood/bots com telemetria para o painel Guerra Fria.")]
    public class GuerraFriaAntiBot : RustPlugin
    {
        private const string PermBypass = "guerrafriaantibot.bypass";
        private const string PermAdmin = "guerrafriaantibot.admin";

        private PluginConfig _config;
        private readonly Dictionary<string, IpState> _ipStates = new Dictionary<string, IpState>();
        private readonly Dictionary<string, double> _blockedIps = new Dictionary<string, double>();
        private readonly Queue<double> _globalAttempts = new Queue<double>();
        private readonly Queue<double> _attemptsOneSecond = new Queue<double>();
        private readonly Queue<Tuple<double, string>> _uniqueIpEvents = new Queue<Tuple<double, string>>();
        private readonly Dictionary<string, int> _uniqueIpMinuteCounts = new Dictionary<string, int>();

        private bool _attackMode;
        private double _attackModeUntil;
        private double _lastAlertAt;
        private long _allowed;
        private long _rejected;
        private long _blocked;

        private class IpState
        {
            public readonly Queue<double> Attempts = new Queue<double>();
            public double LastAttempt;
            public int Strikes;
            public double LastSeen;
        }

        private class PluginConfig
        {
            [JsonProperty("Janela global em segundos")]
            public float GlobalWindowSeconds = 5f;

            [JsonProperty("Tentativas globais na janela para ativar modo ataque")]
            public int GlobalAttackThreshold = 80;

            [JsonProperty("Duracao do modo ataque em segundos")]
            public int AttackModeSeconds = 120;

            [JsonProperty("Janela por IP em segundos")]
            public float PerIpWindowSeconds = 10f;

            [JsonProperty("Maximo de tentativas por IP fora de ataque")]
            public int NormalPerIpLimit = 12;

            [JsonProperty("Maximo de tentativas por IP durante ataque")]
            public int AttackPerIpLimit = 5;

            [JsonProperty("Cooldown minimo entre tentativas do mesmo IP em segundos")]
            public float MinimumReconnectSeconds = 0.75f;

            [JsonProperty("Bloqueio inicial por IP em segundos")]
            public int InitialBlockSeconds = 120;

            [JsonProperty("Bloqueio maximo por IP em segundos")]
            public int MaximumBlockSeconds = 1800;

            [JsonProperty("Multiplicador de bloqueio por reincidencia")]
            public float StrikeMultiplier = 2f;

            [JsonProperty("Mensagem enviada ao cliente bloqueado")]
            public string RejectMessage = "Muitas tentativas de conexao. Aguarde alguns instantes e tente novamente.";

            [JsonProperty("Ignorar administradores authLevel > 0")]
            public bool BypassServerAdmins = true;

            [JsonProperty("Ativar logs de deteccao no console")]
            public bool ConsoleAlerts = true;

            [JsonProperty("Intervalo minimo entre alertas no console em segundos")]
            public int AlertCooldownSeconds = 10;

            [JsonProperty("Limpeza de memoria a cada X segundos")]
            public int CleanupIntervalSeconds = 60;

            [JsonProperty("Esquecer IPs inativos apos X segundos")]
            public int ForgetInactiveIpsSeconds = 900;
        }

        protected override void LoadDefaultConfig()
        {
            _config = new PluginConfig();
            SaveConfig();
        }

        protected override void LoadConfig()
        {
            base.LoadConfig();
            try
            {
                _config = Config.ReadObject<PluginConfig>();
                if (_config == null) throw new Exception("Config nula.");
            }
            catch
            {
                PrintWarning("Configuracao invalida. Gerando configuracao padrao.");
                LoadDefaultConfig();
            }
            ValidateConfig();
            SaveConfig();
        }

        protected override void SaveConfig() => Config.WriteObject(_config, true);

        private void ValidateConfig()
        {
            _config.GlobalWindowSeconds = Mathf.Clamp(_config.GlobalWindowSeconds, 1f, 60f);
            _config.GlobalAttackThreshold = Mathf.Clamp(_config.GlobalAttackThreshold, 10, 5000);
            _config.AttackModeSeconds = Mathf.Clamp(_config.AttackModeSeconds, 10, 3600);
            _config.PerIpWindowSeconds = Mathf.Clamp(_config.PerIpWindowSeconds, 1f, 120f);
            _config.NormalPerIpLimit = Mathf.Clamp(_config.NormalPerIpLimit, 2, 500);
            _config.AttackPerIpLimit = Mathf.Clamp(_config.AttackPerIpLimit, 1, _config.NormalPerIpLimit);
            _config.MinimumReconnectSeconds = Mathf.Clamp(_config.MinimumReconnectSeconds, 0f, 30f);
            _config.InitialBlockSeconds = Mathf.Clamp(_config.InitialBlockSeconds, 10, 86400);
            _config.MaximumBlockSeconds = Mathf.Clamp(_config.MaximumBlockSeconds, _config.InitialBlockSeconds, 86400);
            _config.StrikeMultiplier = Mathf.Clamp(_config.StrikeMultiplier, 1f, 10f);
            _config.AlertCooldownSeconds = Mathf.Clamp(_config.AlertCooldownSeconds, 1, 300);
            _config.CleanupIntervalSeconds = Mathf.Clamp(_config.CleanupIntervalSeconds, 15, 600);
            _config.ForgetInactiveIpsSeconds = Mathf.Clamp(_config.ForgetInactiveIpsSeconds, 60, 86400);
        }

        private void Init()
        {
            permission.RegisterPermission(PermBypass, this);
            permission.RegisterPermission(PermAdmin, this);
            timer.Every(_config.CleanupIntervalSeconds, Cleanup);
        }

        private void OnServerInitialized()
        {
            Puts("GuerraFriaAntiBot v1.1.0 carregado. Protecao L7 e telemetria ativas.");
        }

        private object CanClientLogin(Network.Connection connection)
        {
            if (connection == null) return null;

            string userId = connection.userid.ToString();
            if (_config.BypassServerAdmins && connection.authLevel > 0) return null;
            if (permission.UserHasPermission(userId, PermBypass)) return null;

            string ip = NormalizeIp(connection.ipaddress);
            if (string.IsNullOrEmpty(ip)) return null;

            double now = Time.realtimeSinceStartupAsDouble;
            RecordAttempt(ip, now);

            if (_attackMode && now >= _attackModeUntil)
            {
                _attackMode = false;
                Alert("Modo ataque DESATIVADO: volume de conexoes voltou ao normal.", now, true);
            }

            double blockedUntil;
            if (_blockedIps.TryGetValue(ip, out blockedUntil))
            {
                if (blockedUntil > now)
                {
                    _rejected++;
                    return _config.RejectMessage;
                }
                _blockedIps.Remove(ip);
            }

            TrackGlobalAttempt(now);
            if (!_attackMode && _globalAttempts.Count >= _config.GlobalAttackThreshold)
            {
                _attackMode = true;
                _attackModeUntil = now + _config.AttackModeSeconds;
                Alert("Modo ataque ATIVADO: " + _globalAttempts.Count + " tentativas em " + _config.GlobalWindowSeconds.ToString("0.#") + "s.", now, true);
            }
            else if (_attackMode)
            {
                _attackModeUntil = Math.Max(_attackModeUntil, now + Math.Min(15, _config.AttackModeSeconds));
            }

            IpState state;
            if (!_ipStates.TryGetValue(ip, out state))
            {
                state = new IpState();
                _ipStates[ip] = state;
            }
            state.LastSeen = now;

            if (_config.MinimumReconnectSeconds > 0f && state.LastAttempt > 0 && now - state.LastAttempt < _config.MinimumReconnectSeconds)
            {
                state.Strikes++;
                BlockIp(ip, state, now, "reconexoes rapidas");
                _rejected++;
                return _config.RejectMessage;
            }

            state.LastAttempt = now;
            state.Attempts.Enqueue(now);
            TrimQueue(state.Attempts, now - _config.PerIpWindowSeconds);

            int perIpLimit = _attackMode ? _config.AttackPerIpLimit : _config.NormalPerIpLimit;
            if (state.Attempts.Count > perIpLimit)
            {
                state.Strikes++;
                BlockIp(ip, state, now, state.Attempts.Count + " tentativas/" + _config.PerIpWindowSeconds.ToString("0.#") + "s");
                _rejected++;
                return _config.RejectMessage;
            }

            _allowed++;
            return null;
        }

        private void RecordAttempt(string ip, double now)
        {
            _attemptsOneSecond.Enqueue(now);
            while (_attemptsOneSecond.Count > 0 && _attemptsOneSecond.Peek() < now - 1d) _attemptsOneSecond.Dequeue();

            _uniqueIpEvents.Enqueue(Tuple.Create(now, ip));
            int count;
            _uniqueIpMinuteCounts.TryGetValue(ip, out count);
            _uniqueIpMinuteCounts[ip] = count + 1;
            TrimUniqueIpEvents(now);
        }

        private void TrimUniqueIpEvents(double now)
        {
            while (_uniqueIpEvents.Count > 0 && _uniqueIpEvents.Peek().Item1 < now - 60d)
            {
                var evt = _uniqueIpEvents.Dequeue();
                int count;
                if (!_uniqueIpMinuteCounts.TryGetValue(evt.Item2, out count)) continue;
                if (count <= 1) _uniqueIpMinuteCounts.Remove(evt.Item2);
                else _uniqueIpMinuteCounts[evt.Item2] = count - 1;
            }
        }

        private void TrackGlobalAttempt(double now)
        {
            _globalAttempts.Enqueue(now);
            TrimQueue(_globalAttempts, now - _config.GlobalWindowSeconds);
        }

        private void TrimQueue(Queue<double> queue, double minimumTime)
        {
            while (queue.Count > 0 && queue.Peek() < minimumTime) queue.Dequeue();
        }

        private void BlockIp(string ip, IpState state, double now, string reason)
        {
            int strikeIndex = Math.Max(0, state.Strikes - 1);
            double calculated = _config.InitialBlockSeconds * Math.Pow(_config.StrikeMultiplier, Math.Min(strikeIndex, 8));
            int seconds = Math.Min(_config.MaximumBlockSeconds, (int)Math.Ceiling(calculated));
            _blockedIps[ip] = now + seconds;
            _blocked++;
            state.Attempts.Clear();
            Alert("IP bloqueado temporariamente (" + MaskIp(ip) + ") por " + seconds + "s. Motivo: " + reason + ". Strike: " + state.Strikes + ".", now, false);
        }

        private void Alert(string message, double now, bool force)
        {
            if (!_config.ConsoleAlerts) return;
            if (!force && now - _lastAlertAt < _config.AlertCooldownSeconds) return;
            _lastAlertAt = now;
            PrintWarning("[AntiBot] " + message);
        }

        private void Cleanup()
        {
            double now = Time.realtimeSinceStartupAsDouble;
            var expiredBlocks = new List<string>();
            foreach (var pair in _blockedIps) if (pair.Value <= now) expiredBlocks.Add(pair.Key);
            foreach (string ip in expiredBlocks) _blockedIps.Remove(ip);

            var staleIps = new List<string>();
            foreach (var pair in _ipStates) if (now - pair.Value.LastSeen >= _config.ForgetInactiveIpsSeconds) staleIps.Add(pair.Key);
            foreach (string ip in staleIps) _ipStates.Remove(ip);

            TrimQueue(_globalAttempts, now - _config.GlobalWindowSeconds);
            while (_attemptsOneSecond.Count > 0 && _attemptsOneSecond.Peek() < now - 1d) _attemptsOneSecond.Dequeue();
            TrimUniqueIpEvents(now);
        }

        [ConsoleCommand("antibot.status")]
        private void CmdStatus(ConsoleSystem.Arg arg)
        {
            if (!CanUseAdminCommand(arg)) return;
            double now = Time.realtimeSinceStartupAsDouble;
            string attack = _attackMode ? "ATIVO (" + Math.Max(0, _attackModeUntil - now).ToString("0") + "s restantes)" : "inativo";
            arg.ReplyWith(
                "GuerraFriaAntiBot\n" +
                "Modo ataque: " + attack + "\n" +
                "Conexoes/s: " + _attemptsOneSecond.Count + "\n" +
                "Tentativas na janela global: " + _globalAttempts.Count + "/" + _config.GlobalAttackThreshold + "\n" +
                "IPs unicos no ultimo minuto: " + _uniqueIpMinuteCounts.Count + "\n" +
                "IPs monitorados: " + _ipStates.Count + "\n" +
                "IPs bloqueados agora: " + _blockedIps.Count + "\n" +
                "Permitidas desde load: " + _allowed + "\n" +
                "Recusadas desde load: " + _rejected + "\n" +
                "Bloqueios aplicados desde load: " + _blocked
            );
        }

        [ConsoleCommand("antibot.json")]
        private void CmdJson(ConsoleSystem.Arg arg)
        {
            if (!CanUseAdminCommand(arg)) return;
            double now = Time.realtimeSinceStartupAsDouble;
            TrimQueue(_globalAttempts, now - _config.GlobalWindowSeconds);
            while (_attemptsOneSecond.Count > 0 && _attemptsOneSecond.Peek() < now - 1d) _attemptsOneSecond.Dequeue();
            TrimUniqueIpEvents(now);
            var payload = new
            {
                attackMode = _attackMode,
                attackModeRemainingSeconds = _attackMode ? Math.Max(0, _attackModeUntil - now) : 0,
                attemptsPerSecond = _attemptsOneSecond.Count,
                attemptsLast5Seconds = _globalAttempts.Count,
                uniqueIpsLastMinute = _uniqueIpMinuteCounts.Count,
                blockedIps = _blockedIps.Count,
                monitoredIps = _ipStates.Count,
                rejected = _rejected,
                allowed = _allowed,
                blocksApplied = _blocked
            };
            arg.ReplyWith(JsonConvert.SerializeObject(payload));
        }

        [ConsoleCommand("antibot.attack")]
        private void CmdAttack(ConsoleSystem.Arg arg)
        {
            if (!CanUseAdminCommand(arg)) return;
            string value = arg.GetString(0, "").ToLowerInvariant();
            double now = Time.realtimeSinceStartupAsDouble;
            if (value == "on")
            {
                _attackMode = true;
                _attackModeUntil = now + _config.AttackModeSeconds;
                arg.ReplyWith("Modo ataque ativado manualmente.");
                return;
            }
            if (value == "off")
            {
                _attackMode = false;
                _attackModeUntil = 0;
                arg.ReplyWith("Modo ataque desativado manualmente.");
                return;
            }
            arg.ReplyWith("Uso: antibot.attack on | off");
        }

        [ConsoleCommand("antibot.unblock")]
        private void CmdUnblock(ConsoleSystem.Arg arg)
        {
            if (!CanUseAdminCommand(arg)) return;
            string ip = NormalizeIp(arg.GetString(0, ""));
            if (string.IsNullOrEmpty(ip))
            {
                arg.ReplyWith("Uso: antibot.unblock IP");
                return;
            }
            bool removed = _blockedIps.Remove(ip);
            arg.ReplyWith(removed ? "IP " + ip + " desbloqueado." : "Esse IP nao estava bloqueado.");
        }

        private bool CanUseAdminCommand(ConsoleSystem.Arg arg)
        {
            if (arg.Connection == null) return true;
            ulong userId = arg.Connection.userid;
            if (arg.Connection.authLevel >= 2) return true;
            if (permission.UserHasPermission(userId.ToString(), PermAdmin)) return true;
            arg.ReplyWith("Sem permissao.");
            return false;
        }

        private string NormalizeIp(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return string.Empty;
            raw = raw.Trim();
            if (raw.StartsWith("["))
            {
                int end = raw.IndexOf(']');
                if (end > 0) return raw.Substring(1, end - 1);
            }
            int colonCount = 0;
            foreach (char c in raw) if (c == ':') colonCount++;
            if (colonCount == 1)
            {
                int index = raw.LastIndexOf(':');
                if (index > 0) return raw.Substring(0, index);
            }
            return raw;
        }

        private string MaskIp(string ip)
        {
            if (string.IsNullOrEmpty(ip)) return "desconhecido";
            string[] parts = ip.Split('.');
            if (parts.Length == 4) return parts[0] + "." + parts[1] + ".x.x";
            if (ip.Length <= 8) return ip;
            return ip.Substring(0, 8) + "...";
        }
    }
}
