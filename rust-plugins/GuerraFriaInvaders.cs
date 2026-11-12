using System;
using System.Collections.Generic;
using System.Linq;
using Oxide.Core;
using Oxide.Core.Libraries.Covalence;
using Oxide.Core.Plugins;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("GuerraFriaInvaders", "Guerra Fria", "1.0.0")]
    [Description("Base Invaders da Guerra Fria: inscrição em trio ou solo, sorteio de solos em trios e controle de fases")]
    public class GuerraFriaInvaders : RustPlugin
    {
        // Janela total de 5h: 1h30 farm/build, 1h30 PVP, 2h raid.
        private const int FarmMinutes = 90;
        private const int PvpMinutes = 90;
        private const int RaidMinutes = 120;
        private const int TeamSize = 3;

        private const string Prefix = "<color=#ffcc00>[Base Invaders]</color> ";
        private const string DataFile = "GuerraFriaInvaders";

        private StoredData data;
        private string phase = "parado";
        private DateTime phaseEndsAt = DateTime.MinValue;
        private readonly System.Random random = new System.Random();

        private class TeamData
        {
            public string Name;
            public List<ulong> Members = new List<ulong>();
            public int Score;
        }

        private class StoredData
        {
            public Dictionary<string, TeamData> Teams = new Dictionary<string, TeamData>(StringComparer.OrdinalIgnoreCase);
            public List<ulong> Solos = new List<ulong>();
            public Dictionary<ulong, string> PlayerTeam = new Dictionary<ulong, string>();
        }

        private void Init()
        {
            LoadData();
        }

        private void Unload()
        {
            SaveData();
        }

        private void OnServerSave()
        {
            SaveData();
        }

        private void LoadData()
        {
            try
            {
                data = Interface.Oxide.DataFileSystem.ReadObject<StoredData>(DataFile) ?? new StoredData();
            }
            catch (Exception ex)
            {
                // Dados corrompidos não devem derrubar o servidor; começa limpo e registra o erro.
                PrintError($"Falha ao ler {DataFile}, iniciando vazio: {ex.Message}");
                data = new StoredData();
            }
        }

        private void SaveData()
        {
            if (data == null) return;
            Interface.Oxide.DataFileSystem.WriteObject(DataFile, data);
        }

        // ---------- Inscrição ----------

        [ChatCommand("solo")]
        private void CmdSolo(BasePlayer player, string command, string[] args)
        {
            if (phase != "parado")
            {
                player.ChatMessage(Prefix + "Inscrições fechadas. O evento já começou.");
                return;
            }
            if (data.PlayerTeam.ContainsKey(player.userID))
            {
                player.ChatMessage(Prefix + "Você já está em um time.");
                return;
            }
            if (data.Solos.Contains(player.userID))
            {
                player.ChatMessage(Prefix + "Você já está na lista solo.");
                return;
            }
            data.Solos.Add(player.userID);
            SaveData();
            player.ChatMessage(Prefix + "Inscrito solo. No início do evento você será sorteado em um trio.");
        }

        [ChatCommand("trio")]
        private void CmdTrio(BasePlayer player, string command, string[] args)
        {
            if (args.Length == 0)
            {
                player.ChatMessage(Prefix + "Uso: /trio criar NOME | /trio convidar JOGADOR | /trio sair");
                return;
            }
            if (phase != "parado")
            {
                player.ChatMessage(Prefix + "Inscrições fechadas. O evento já começou.");
                return;
            }

            switch (args[0].ToLowerInvariant())
            {
                case "criar":
                    CreateTeam(player, args.Length > 1 ? string.Join(" ", args.Skip(1)) : null);
                    break;
                case "convidar":
                    InvitePlayer(player, args.Length > 1 ? string.Join(" ", args.Skip(1)) : null);
                    break;
                case "sair":
                    LeaveTeam(player);
                    break;
                default:
                    player.ChatMessage(Prefix + "Opção inválida. Use criar, convidar ou sair.");
                    break;
            }
        }

        private void CreateTeam(BasePlayer player, string name)
        {
            if (string.IsNullOrWhiteSpace(name) || name.Length > 24)
            {
                player.ChatMessage(Prefix + "Informe um nome de time com até 24 caracteres.");
                return;
            }
            if (data.PlayerTeam.ContainsKey(player.userID) || data.Solos.Contains(player.userID))
            {
                player.ChatMessage(Prefix + "Você já está em um time ou na lista solo.");
                return;
            }
            if (data.Teams.ContainsKey(name))
            {
                player.ChatMessage(Prefix + "Esse nome de time já existe.");
                return;
            }

            var team = new TeamData { Name = name };
            team.Members.Add(player.userID);
            data.Teams[name] = team;
            data.PlayerTeam[player.userID] = name;
            SaveData();
            player.ChatMessage(Prefix + $"Time <color=#66ccff>{name}</color> criado. Convide mais {TeamSize - 1} jogador(es) com /trio convidar NOME.");
        }

        private void InvitePlayer(BasePlayer player, string targetName)
        {
            if (!data.PlayerTeam.TryGetValue(player.userID, out var teamName))
            {
                player.ChatMessage(Prefix + "Você precisa criar um time primeiro.");
                return;
            }
            var team = data.Teams[teamName];
            if (team.Members.Count >= TeamSize)
            {
                player.ChatMessage(Prefix + "Seu time já está completo.");
                return;
            }

            var target = BasePlayer.allPlayerList.FirstOrDefault(p => p.displayName.Equals(targetName, StringComparison.OrdinalIgnoreCase));
            if (target == null)
            {
                player.ChatMessage(Prefix + "Jogador não encontrado online. Ele precisa estar no servidor.");
                return;
            }
            if (data.PlayerTeam.ContainsKey(target.userID) || data.Solos.Contains(target.userID))
            {
                player.ChatMessage(Prefix + "Esse jogador já está em um time ou na lista solo.");
                return;
            }

            team.Members.Add(target.userID);
            data.PlayerTeam[target.userID] = teamName;
            SaveData();
            target.ChatMessage(Prefix + $"Você entrou no time <color=#66ccff>{teamName}</color>.");
            player.ChatMessage(Prefix + $"{target.displayName} entrou no time. ({team.Members.Count}/{TeamSize})");
        }

        private void LeaveTeam(BasePlayer player)
        {
            if (data.Solos.Remove(player.userID))
            {
                SaveData();
                player.ChatMessage(Prefix + "Você saiu da lista solo.");
                return;
            }
            if (!data.PlayerTeam.TryGetValue(player.userID, out var teamName))
            {
                player.ChatMessage(Prefix + "Você não está em nenhum time.");
                return;
            }

            var team = data.Teams[teamName];
            team.Members.Remove(player.userID);
            data.PlayerTeam.Remove(player.userID);
            if (team.Members.Count == 0) data.Teams.Remove(teamName);
            SaveData();
            player.ChatMessage(Prefix + "Você saiu do time.");
        }

        // ---------- Sorteio e fases ----------

        [ConsoleCommand("invaders.start")]
        private void CmdStart(ConsoleSystem.Arg arg)
        {
            if (!arg.IsAdmin)
            {
                arg.ReplyWith("Sem permissão.");
                return;
            }
            if (phase != "parado")
            {
                arg.ReplyWith("O evento já está em andamento.");
                return;
            }
            StartEvent();
        }

        [ConsoleCommand("invaders.stop")]
        private void CmdStop(ConsoleSystem.Arg arg)
        {
            if (!arg.IsAdmin)
            {
                arg.ReplyWith("Sem permissão.");
                return;
            }
            phase = "parado";
            phaseEndsAt = DateTime.MinValue;
            Broadcast("Evento encerrado pela administração.");
        }

        private void StartEvent()
        {
            var leftover = FormTrios();
            SaveData();

            if (leftover.Count > 0)
            {
                PrintWarning($"{leftover.Count} solo(s) sem trio completo: {string.Join(", ", leftover)}");
            }

            SetPhase("farm", FarmMinutes);
        }

        // Preenche times incompletos primeiro e depois forma trios com os solos restantes.
        // Quem sobrar (menos de 3) é devolvido para o admin revisar.
        private List<ulong> FormTrios()
        {
            var pool = data.Solos.OrderBy(_ => random.Next()).ToList();

            foreach (var team in data.Teams.Values.Where(t => t.Members.Count < TeamSize).ToList())
            {
                while (team.Members.Count < TeamSize && pool.Count > 0)
                {
                    var id = pool[0];
                    pool.RemoveAt(0);
                    team.Members.Add(id);
                    data.PlayerTeam[id] = team.Name;
                }
            }

            int index = 1;
            while (pool.Count >= TeamSize)
            {
                string name;
                do { name = $"Sorteio-{index++}"; } while (data.Teams.ContainsKey(name));
                var team = new TeamData { Name = name };
                for (int i = 0; i < TeamSize; i++)
                {
                    var id = pool[0];
                    pool.RemoveAt(0);
                    team.Members.Add(id);
                    data.PlayerTeam[id] = team.Name;
                }
                data.Teams[team.Name] = team;
            }

            data.Solos.Clear();
            return pool;
        }

        private void SetPhase(string next, int minutes)
        {
            phase = next;
            phaseEndsAt = DateTime.UtcNow.AddMinutes(minutes);
            Broadcast($"Fase <color=#66ccff>{PhaseLabel(next)}</color> começou. Duração: {minutes} minutos.");
            timer.Once(minutes * 60f, () => AdvancePhase(next));
        }

        // Só avança quando o timer da fase atual dispara, para não encerrar o evento antes da hora.
        private void AdvancePhase(string finished)
        {
            switch (finished)
            {
                case "farm":
                    SetPhase("pvp", PvpMinutes);
                    break;
                case "pvp":
                    SetPhase("raid", RaidMinutes);
                    break;
                case "raid":
                    phase = "fim";
                    phaseEndsAt = DateTime.MinValue;
                    Broadcast("Base Invaders encerrado. Confira o placar com /invaders.");
                    break;
            }
        }

        private static string PhaseLabel(string p)
        {
            switch (p)
            {
                case "farm": return "Farm/Build";
                case "pvp": return "PVP";
                case "raid": return "Raid";
                case "fim": return "Fim";
                default: return "Parado";
            }
        }

        // ---------- Regras de combate ----------

        // Farm/Build: sem dano a jogadores. PVP: bloqueia fogo amigo entre membros do mesmo time.
        private object OnEntityTakeDamage(BasePlayer victim, HitInfo info)
        {
            if (victim == null || info == null) return null;
            if (phase == "farm")
            {
                info.damageTypes.ScaleAll(0f);
                return null;
            }

            var attacker = info.InitiatorPlayer;
            if (attacker != null && IsSameTeam(attacker.userID, victim.userID))
            {
                info.damageTypes.ScaleAll(0f);
            }
            return null;
        }

        private void OnPlayerDeath(BasePlayer victim, HitInfo info)
        {
            if (phase != "pvp" && phase != "raid") return;
            var attacker = info?.InitiatorPlayer;
            if (attacker == null || victim == null || attacker.userID == victim.userID) return;
            if (IsSameTeam(attacker.userID, victim.userID)) return;

            if (data.PlayerTeam.TryGetValue(attacker.userID, out var teamName) && data.Teams.TryGetValue(teamName, out var team))
            {
                team.Score += 1;
                SaveData();
            }
        }

        private bool IsSameTeam(ulong a, ulong b)
        {
            return data.PlayerTeam.TryGetValue(a, out var ta)
                && data.PlayerTeam.TryGetValue(b, out var tb)
                && ta == tb;
        }

        // shortcut: pontuação só de kills (+1). Falta TC destruído (+40), crates (+3/+10) e defesa de raid. Próximo passo: hooks de entidade e marcação de TC.

        // ---------- Consulta ----------

        [ChatCommand("invaders")]
        private void CmdInfo(BasePlayer player, string command, string[] args)
        {
            var left = phaseEndsAt > DateTime.UtcNow ? (phaseEndsAt - DateTime.UtcNow).ToString(@"hh\:mm\:ss") : "-";
            player.ChatMessage(Prefix + $"Fase: {PhaseLabel(phase)} | Tempo restante: {left}");

            var top = data.Teams.Values.OrderByDescending(t => t.Score).Take(5);
            foreach (var t in top)
            {
                player.ChatMessage($"{t.Name}: {t.Score} pontos ({t.Members.Count}/{TeamSize})");
            }
        }

        private void Broadcast(string message)
        {
            rust.BroadcastChat(Prefix + message);
        }
    }
}
