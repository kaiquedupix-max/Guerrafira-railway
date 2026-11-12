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
    [Description("Guerra Fria Invaders: inscrição em trio ou solo, sorteio de solos em trios e controle de fases")]
    public class GuerraFriaInvaders : RustPlugin
    {
        // Janela total de 5h: 1h30 farm/build, 1h30 PVP, 2h raid.
        private const int FarmMinutes = 90;
        private const int PvpMinutes = 90;
        private const int RaidMinutes = 120;
        private const int TeamSize = 3;
        // Vagas do evento: as 33 primeiras equipes a entrar no servidor durante o evento jogam; as demais são desconectadas.
        private const int MaxActiveTeams = 33;

        private const string Prefix = "<color=#ffcc00>[Guerra Fria Invaders]</color> ";
        private const string DataFile = "GuerraFriaInvaders";

        private StoredData data;
        private readonly HashSet<ulong> claimedCrates = new HashSet<ulong>();
        private readonly Dictionary<ulong, bool> armedAtDeath = new Dictionary<ulong, bool>();
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
            public HashSet<ulong> Approved = new HashSet<ulong>();
            public Dictionary<ulong, string> PlayerTeam = new Dictionary<ulong, string>();
            public List<string> ActiveTeams = new List<string>();
        }

        private readonly Dictionary<string, RaidState> activeRaids = new Dictionary<string, RaidState>(StringComparer.OrdinalIgnoreCase);
        private const int RaidIdleSeconds = 600;
        private const int RaidDefensePointsMax = 40;

        private class RaidState
        {
            public DateTime Start;
            public DateTime LastHit;
        }

        protected override void LoadDefaultConfig()
        {
            // Token deve ser o mesmo INVADERS_SYNC_TOKEN configurado no site. Vazio desativa a sincronização.
            Config["SyncUrl"] = "https://www.guerrafriarust.com.br/api/base-invaders/exportacao";
            Config["SyncToken"] = "";
            // false: as checagens de geometria só avisam o admin no console (nada é removido).
            // true: a colocação que viola a regra é removida. Ative depois de validar no teste em jogo.
            Config["EnforceGeometry"] = true;
        }

        private bool EnforceGeometry => Config["EnforceGeometry"] is bool b && b;

        // Checagens de geometria do regulamento. Heurísticas por distância e contagem de peças.
        // Em modo de aviso, só registra no console; em modo de enforcement, remove a peça infratora.
        private bool GeometryViolation(BaseEntity entity, BasePlayer builder, string reason)
        {
            var msg = $"[Geometria] {entity.ShortPrefabName}: {reason}";
            PrintWarning(msg);
            builder?.ChatMessage(Prefix + reason + (EnforceGeometry ? " A colocação foi removida." : " (aviso: ainda não é obrigatório)"));
            if (!EnforceGeometry) return false;
            entity.Kill();
            return true;
        }

        // Caminho livre até o TC: a linha entre a entrada e o TC não pode ter parede ou fundação no meio.
        private bool PathBlocked(BaseEntity tc)
        {
            foreach (var entrance in UnityEngine.Object.FindObjectsOfType<BaseEntity>()
                .Where(e => e != tc && IsEntrance(e) && Vector3.Distance(e.transform.position, tc.transform.position) <= 2.5f))
            {
                var from = entrance.transform.position;
                var to = tc.transform.position;
                var blockers = Physics.RaycastAll(from, (to - from).normalized, Vector3.Distance(from, to))
                    .Select(h => h.collider?.GetComponentInParent<BaseEntity>())
                    .Where(b => b != null && b != entrance && b != tc && (b.ShortPrefabName.Contains("wall") || b.ShortPrefabName.Contains("foundation")))
                    .Any();
                if (!blockers) return false;
            }
            return true;
        }

        private static bool IsEntrance(BaseEntity e) =>
            e.ShortPrefabName.Contains("door") || e.ShortPrefabName.Contains("window") || e.ShortPrefabName.Contains("hatch");

        // TC selado: paredes fechando pelo menos 4 lados a até 1 m do TC.
        private bool TcSealed(BaseEntity tc)
        {
            var sides = new[] { Vector3.forward, Vector3.back, Vector3.left, Vector3.right };
            int closed = 0;
            foreach (var dir in sides)
            {
                var origin = tc.transform.position + Vector3.up * 0.5f;
                if (Physics.Raycast(origin, dir, 1f))
                    closed++;
            }
            return closed >= 4;
        }

        // Extensão de fundação com parede: parede sobre uma fundação que não está colada a um TC da equipe.
        private bool WallOnExtraFoundation(BaseEntity wall)
        {
            if (!wall.ShortPrefabName.Contains("wall")) return false;
            return UnityEngine.Object.FindObjectsOfType<BaseEntity>()
                .Any(f => f.ShortPrefabName.Contains("foundation")
                    && Vector3.Distance(f.transform.position, wall.transform.position) <= 1.5f
                    && !UnityEngine.Object.FindObjectsOfType<BuildingPrivlidge>().Any(tc => Vector3.Distance(tc.transform.position, f.transform.position) <= 6f));
        }

        private void Init()
        {
            LoadData();
            timer.Every(60f, () => CheckRaids(false));
            // Atualiza as inscrições aprovadas do site a cada 5 min, para o cadastro valer antes e durante o evento.
            timer.Every(300f, () => SyncRegistrations());
            // Busca as aprovações logo ao carregar, para ninguém aprovado ser barrado até o primeiro ciclo de 5 min.
            SyncRegistrations();
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
            if (!IsRegistered(player))
            {
                player.ChatMessage(Prefix + "Você não está cadastrado no site. Faça sua inscrição antes de entrar na lista solo.");
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
            if (!IsRegistered(player))
            {
                player.ChatMessage(Prefix + "Você não está cadastrado no site. Faça sua inscrição antes de criar um time.");
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
            if (!IsRegistered(target))
            {
                player.ChatMessage(Prefix + "Esse jogador não está cadastrado no site.");
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
            BeginStart();
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

        // Teste de sincronização: baixa as aprovadas do site e só mostra a contagem no console. Não grava nada e não inicia o evento.
        [ConsoleCommand("invaders.preview")]
        private void CmdPreview(ConsoleSystem.Arg arg)
        {
            if (!arg.IsAdmin)
            {
                arg.ReplyWith("Sem permissão.");
                return;
            }
            var token = Config["SyncToken"]?.ToString() ?? "";
            var url = Config["SyncUrl"]?.ToString() ?? "";
            if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(url))
            {
                arg.ReplyWith("SyncToken vazio: sincronização desativada.");
                return;
            }
            var headers = new Dictionary<string, string> { { "x-invaders-token", token } };
            webrequest.Enqueue(url, null, (code, body) =>
            {
                if (code != 200 || string.IsNullOrEmpty(body))
                {
                    PrintWarning($"Preview: falha HTTP {code} ao falar com o site.");
                    return;
                }
                var teams = (Newtonsoft.Json.Linq.JArray)Newtonsoft.Json.Linq.JObject.Parse(body)["teams"];
                int trios = 0, solos = 0;
                foreach (var item in teams ?? new Newtonsoft.Json.Linq.JArray())
                {
                    if ((string)item["mode"] == "random") solos += ((Newtonsoft.Json.Linq.JArray)item["players"]).Count;
                    else trios++;
                }
                PrintWarning($"Preview: {trios} trio(s) aprovado(s) e {solos} solo(s) aprovado(s) no site. Nada foi gravado.");
            }, this, headers: headers);
        }

        // Puxa as inscrições aprovadas do site sem iniciar o evento. Chamado a cada 5 min e antes do início.
        private void SyncRegistrations()
        {
            var token = Config["SyncToken"]?.ToString() ?? "";
            var url = Config["SyncUrl"]?.ToString() ?? "";
            if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(url)) return;

            var headers = new Dictionary<string, string> { { "x-invaders-token", token } };
            webrequest.Enqueue(url, null, (code, body) =>
            {
                if (code != 200 || string.IsNullOrEmpty(body))
                {
                    PrintWarning($"Sincronização de cadastros falhou (HTTP {code}).");
                    return;
                }
                try { ImportApprovedRegistrations(body); }
                catch (Exception ex) { PrintError($"Cadastros do site inválidos: {ex.Message}"); }
            }, this, headers: headers);
        }

        // Antes de sortear, puxa as inscrições aprovadas do site. Sem token ou sem resposta, segue só com as inscrições in-game.
        private void BeginStart()
        {
            var token = Config["SyncToken"]?.ToString() ?? "";
            var url = Config["SyncUrl"]?.ToString() ?? "";
            if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(url))
            {
                PrintWarning("Sincronização com o site desativada (SyncToken vazio). Usando só inscrições in-game.");
                StartEvent();
                return;
            }

            var headers = new Dictionary<string, string> { { "x-invaders-token", token } };
            webrequest.Enqueue(url, null, (code, body) =>
            {
                if (code != 200 || string.IsNullOrEmpty(body))
                {
                    PrintWarning($"Falha ao sincronizar com o site (HTTP {code}). Usando só inscrições in-game.");
                    StartEvent();
                    return;
                }
                try
                {
                    ImportApprovedRegistrations(body);
                }
                catch (Exception ex)
                {
                    PrintError($"Inscrições do site inválidas: {ex.Message}. Usando só inscrições in-game.");
                }
                StartEvent();
            }, this, headers: headers);
        }

        // Só entra o que foi aprovado no site. Times de 3 vêm prontos; solos entram na lista para o sorteio.
        private void ImportApprovedRegistrations(string json)
        {
            var root = Newtonsoft.Json.Linq.JObject.Parse(json);
            var teams = (Newtonsoft.Json.Linq.JArray)root["teams"];
            if (teams == null) return;

            // O site é a fonte da verdade: quem não está aprovado lá não entra em /solo nem /trio.
            var approved = new HashSet<ulong>();
            foreach (var item in teams)
            {
                var approvedPlayers = (Newtonsoft.Json.Linq.JArray)item["players"];
                if (approvedPlayers == null) continue;
                foreach (var p in approvedPlayers) approved.Add(ulong.Parse((string)p["steamId"]));
            }
            data.Approved = approved;
            data.Solos.RemoveAll(id => !approved.Contains(id));

            int imported = 0;
            foreach (var item in teams)
            {
                var mode = (string)item["mode"];
                var name = (string)item["teamName"];
                var players = (Newtonsoft.Json.Linq.JArray)item["players"];
                if (players == null || players.Count == 0) continue;

                var ids = players.Select(p => ulong.Parse((string)p["steamId"])).ToList();
                if (mode == "random")
                {
                    foreach (var id in ids)
                    {
                        if (AlreadyRegistered(id)) continue;
                        data.Solos.Add(id);
                        imported++;
                    }
                    continue;
                }

                if (ids.Count != TeamSize || ids.Any(AlreadyRegistered) || data.Teams.ContainsKey(name)) continue;
                data.Teams[name] = new TeamData { Name = name, Members = ids };
                foreach (var id in ids) data.PlayerTeam[id] = name;
                imported++;
            }

            SaveData();
            PrintWarning($"Sincronizado com o site: {imported} inscrição(ões) aprovada(s) importada(s).");
        }

        private bool AlreadyRegistered(ulong id)
        {
            return data.PlayerTeam.ContainsKey(id) || data.Solos.Contains(id);
        }

        // Cadastro vale quando o site aprovou (ou já está em time vindo do site). Admins e owners sempre passam.
        private bool IsRegistered(BasePlayer player)
        {
            return player.IsAdmin || data.Approved.Contains(player.userID) || data.PlayerTeam.ContainsKey(player.userID);
        }

        // Fila de solos, em ordem de entrada no servidor. Quem não tem time e está inscrito solo entra aqui.
        private readonly List<ulong> soloQueue = new List<ulong>();
        private bool eventLocked;

        // Controle de vagas e montagem dos trios:
        // - Time já formado: ocupa uma das 33 vagas quando o primeiro membro entra.
        // - Solo inscrito: entra na fila pela ordem de chegada; a cada 3 solos na fila, forma-se um trio no sorteio.
        // - Ao completar 33 equipes, o evento trava: quem não está em equipe ativa é desconectado e não reconecta até o fim.
        private void OnPlayerInit(BasePlayer player)
        {
            if (player == null || player.IsAdmin) return;

            // Sem cadastro (time ou inscrição solo aprovada), ninguém entra, o tempo todo. Admins e owners passam.
            bool registered = IsRegistered(player);
            if (!registered)
            {
                player.Kick("Você não está cadastrado neste evento. Faça sua inscrição no site.");
                return;
            }

            // Antes do início e depois do fim, cadastrado entra normalmente; as vagas só valem durante o evento.
            if (phase == "parado" || phase == "fim") return;

            if (data.PlayerTeam.TryGetValue(player.userID, out var teamName))
            {
                if (data.ActiveTeams.Contains(teamName)) return;
                if (eventLocked || data.ActiveTeams.Count >= MaxActiveTeams)
                {
                    player.Kick($"O evento já tem {MaxActiveTeams} equipes em jogo. Você não pode entrar até o fim do evento.");
                    return;
                }
                ActivateTeam(teamName);
                return;
            }

            if (eventLocked)
            {
                player.Kick($"O evento já tem {MaxActiveTeams} equipes em jogo. Você não pode entrar até o fim do evento.");
                return;
            }
            if (!data.Solos.Contains(player.userID))
            {
                player.Kick("Você não está inscrito neste evento.");
                return;
            }
            if (!soloQueue.Contains(player.userID)) soloQueue.Add(player.userID);
            Broadcast($"{player.displayName} entrou na fila solo ({soloQueue.Count} na fila).");
            TryFormTrios();
        }

        private void OnPlayerDisconnected(BasePlayer player)
        {
            if (player == null) return;
            soloQueue.Remove(player.userID);
        }

        private void ActivateTeam(string teamName)
        {
            data.ActiveTeams.Add(teamName);
            SaveData();
            Broadcast($"<color=#66ccff>{teamName}</color> entrou no evento ({data.ActiveTeams.Count}/{MaxActiveTeams}).");
            CheckLock();
        }

        // Forma trios com os solos da fila, pela ordem de entrada: pega os 3 primeiros e embaralha a formação.
        private void TryFormTrios()
        {
            while (!eventLocked && soloQueue.Count >= TeamSize)
            {
                var group = soloQueue.Take(TeamSize).ToList();
                soloQueue.RemoveRange(0, TeamSize);
                var shuffled = group.OrderBy(_ => random.Next()).ToList();

                string name;
                int index = data.Teams.Count + 1;
                do { name = $"Sorteio-{index++}"; } while (data.Teams.ContainsKey(name));
                var team = new TeamData { Name = name, Members = shuffled };
                data.Teams[name] = team;
                foreach (var id in shuffled)
                {
                    data.PlayerTeam[id] = name;
                    data.Solos.Remove(id);
                }
                SaveData();
                Broadcast($"Trio sorteado <color=#66ccff>{name}</color>: {string.Join(", ", shuffled.Select(id => NameOf(id)))}.");
                ActivateTeam(name);
            }
        }

        private string NameOf(ulong id)
        {
            var online = BasePlayer.activePlayerList.FirstOrDefault(p => p.userID == id);
            return online != null ? online.displayName : id.ToString();
        }

        // Ao completar as 33 equipes, trava o evento e desconecta todo mundo que não está em equipe ativa.
        private void CheckLock()
        {
            if (eventLocked || data.ActiveTeams.Count < MaxActiveTeams) return;
            eventLocked = true;
            soloQueue.Clear();
            Broadcast($"As {MaxActiveTeams} equipes estão completas. O restante foi desconectado e não pode reconectar até o fim do evento.");
            foreach (var p in BasePlayer.activePlayerList.ToList())
            {
                if (p == null || p.IsAdmin) continue;
                if (data.PlayerTeam.TryGetValue(p.userID, out var t) && data.ActiveTeams.Contains(t)) continue;
                p.Kick("O evento está completo com 33 equipes. Você não pode entrar até o fim do evento.");
            }
        }

        private void StartEvent()
        {
            // Solos não são sorteados agora: montam trios conforme entram no servidor (ver TryFormTrios).
            data.ActiveTeams.Clear();
            soloQueue.Clear();
            eventLocked = false;
            SaveData();
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
            // Avisos de contagem regressiva: 10 min e 1 min antes do fim da fase.
            if (minutes > 10) timer.Once((minutes - 10) * 60f, () => Broadcast($"Faltam <b>10 minutos</b> para o fim da fase {PhaseLabel(next)}."));
            if (minutes > 1) timer.Once((minutes - 1) * 60f, () => Broadcast($"Faltam <b>1 minuto</b> para o fim da fase {PhaseLabel(next)}."));
            timer.Once(minutes * 60f, () => AdvancePhase(next));
        }

        // Pódio do evento: top 3 pelo placar; empate no terceiro lugar é mostrado.
        private void AnnouncePodium()
        {
            var ranking = data.Teams.Values.OrderByDescending(t => t.Score).ToList();
            if (ranking.Count == 0)
            {
                Broadcast("Nenhum time pontuou neste Guerra Fria Invaders.");
                return;
            }
            var medals = new[] { "🥇", "🥈", "🥉" };
            for (int i = 0; i < Math.Min(3, ranking.Count); i++)
            {
                Broadcast($"{medals[i]} <color=#66ccff>{ranking[i].Name}</color> — {ranking[i].Score} pontos");
            }
            if (ranking.Count > 1 && ranking[0].Score == ranking[1].Score)
            {
                Broadcast("Empate no primeiro lugar: a organização decide o desempate conforme o regulamento.");
            }
        }

        // Console do admin: lista times e placar sem alterar nada.
        [ConsoleCommand("invaders.teams")]
        private void CmdTeams(ConsoleSystem.Arg arg)
        {
            if (!arg.IsAdmin)
            {
                arg.ReplyWith("Sem permissão.");
                return;
            }
            var lines = data.Teams.Values.OrderByDescending(t => t.Score)
                .Select(t => $"{t.Name}: {t.Score} pontos ({t.Members.Count}/{TeamSize})");
            arg.ReplyWith(string.Join("\n", lines));
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
                    CheckRaids(true);
                    phase = "fim";
                    phaseEndsAt = DateTime.MinValue;
                    Broadcast("Guerra Fria Invaders encerrado.");
                    AnnouncePodium();
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
        private object OnEntityTakeDamage(BaseCombatEntity victim, HitInfo info)
        {
            if (victim == null || info == null) return null;

            var victimPlayer = victim as BasePlayer;
            if (victimPlayer == null)
            {
                TrackRaid(victim, info);
                return null;
            }

            // Guarda se o jogador estava armado no golpe que o mata. Assim a regra não depende do inventário, que o servidor pode soltar antes do OnPlayerDeath.
            if (victimPlayer.health - info.damageTypes.Total() <= 0f)
            {
                var heldAtHit = victimPlayer.GetActiveItem()?.GetHeldEntity();
                armedAtDeath[victimPlayer.userID] = heldAtHit is BaseProjectile || heldAtHit is BaseMelee;
            }

            if (phase == "farm")
            {
                info.damageTypes.ScaleAll(0f);
                return null;
            }

            var attacker = info.InitiatorPlayer;
            if (attacker != null && IsSameTeam(attacker.userID, victimPlayer.userID))
            {
                info.damageTypes.ScaleAll(0f);
            }
            return null;
        }

        // Defesa de raid: a cada 10 min de raid contínua contra a base de um time, o defensor soma 10 pontos (teto 40).
        // shortcut: fórmula de 10 pts/10 min é uma aproximação do "até +40, mais para raids longas"; confirmar com a regra oficial.
        private void TrackRaid(BaseCombatEntity victim, HitInfo info)
        {
            if (phase != "raid") return;
            var attacker = info.InitiatorPlayer;
            if (attacker == null || victim.OwnerID == 0) return;
            if (!data.PlayerTeam.TryGetValue(victim.OwnerID, out var defenderTeam)) return;
            if (data.PlayerTeam.TryGetValue(attacker.userID, out var attackerTeam) && attackerTeam == defenderTeam) return;

            var now = DateTime.UtcNow;
            if (!activeRaids.TryGetValue(defenderTeam, out var raid))
            {
                raid = new RaidState { Start = now };
                activeRaids[defenderTeam] = raid;
                Broadcast($"Raid contra <color=#ff6666>{defenderTeam}</color> começou. Zona vermelha ativa.");
            }
            raid.LastHit = now;
        }

        private void CheckRaids(bool force)
        {
            var now = DateTime.UtcNow;
            foreach (var entry in activeRaids.ToList())
            {
                var raid = entry.Value;
                if (!force && (now - raid.LastHit).TotalSeconds < RaidIdleSeconds) continue;

                activeRaids.Remove(entry.Key);
                var minutes = (raid.LastHit - raid.Start).TotalMinutes;
                var points = Math.Min(RaidDefensePointsMax, 10 * (int)(minutes / 10));
                if (points <= 0 || !data.Teams.TryGetValue(entry.Key, out var team)) continue;

                team.Score += points;
                SaveData();
                Broadcast($"<color=#66ccff>{entry.Key}</color> defendeu a raid (+{points}).");
            }
        }

        private void OnPlayerDeath(BasePlayer victim, HitInfo info)
        {
            if (phase != "pvp" && phase != "raid") return;
            var attacker = info?.InitiatorPlayer;
            if (attacker == null || victim == null || attacker.userID == victim.userID) return;
            if (IsSameTeam(attacker.userID, victim.userID)) return;

            // Regra do regulamento: a eliminação só vale ponto se o eliminado estava armado, com a arma na mão no golpe fatal.
            var armed = armedAtDeath.TryGetValue(victim.userID, out var wasArmed) && wasArmed;
            armedAtDeath.Remove(victim.userID);
            if (!armed) return;

            if (data.PlayerTeam.TryGetValue(attacker.userID, out var teamName) && data.Teams.TryGetValue(teamName, out var team))
            {
                team.Score += 1;
                SaveData();
                Broadcast($"<color=#66ccff>{teamName}</color> ganhou <b>+1</b> ponto: {attacker.displayName} eliminou {victim.displayName}. (total: {team.Score})");
            }
        }

        // TC destruído por outro time: +40. Só conta quando o TC tem dono registrado em time.
        private void OnEntityDeath(BaseCombatEntity entity, HitInfo info)
        {
            if (phase != "pvp" && phase != "raid") return;
            if (!(entity is BuildingPrivlidge)) return;
            var attacker = info?.InitiatorPlayer;
            if (attacker == null) return;
            if (!data.PlayerTeam.TryGetValue(entity.OwnerID, out var ownerTeam)) return;
            if (!data.PlayerTeam.TryGetValue(attacker.userID, out var attackerTeam)) return;
            if (ownerTeam == attackerTeam) return;

            if (data.Teams.TryGetValue(attackerTeam, out var team))
            {
                team.Score += 40;
                SaveData();
                Broadcast($"<color=#66ccff>{attackerTeam}</color> destruiu o TC de <color=#ff6666>{ownerTeam}</color> (+40).");
            }
        }

        // Crates de evento: Bradley e Patrol Heli valem +3; hackable vale +10. Cada crate pontua uma vez.
        private void OnLootEntityEnd(BasePlayer player, LootContainer container)
        {
            if (phase != "pvp" && phase != "raid") return;
            if (player == null || container == null) return;
            if (!data.PlayerTeam.TryGetValue(player.userID, out var teamName)) return;
            if (!data.Teams.TryGetValue(teamName, out var team)) return;

            int points;
            switch (container.ShortPrefabName)
            {
                case "bradley_crate":
                case "heli_crate":
                    points = 3;
                    break;
                case "codelockedhackablecrate":
                    points = 10;
                    break;
                default:
                    return;
            }

            var crateId = container.net != null ? container.net.ID.Value : 0UL;
            if (!claimedCrates.Add(crateId)) return;
            team.Score += points;
            SaveData();
            Broadcast($"<color=#66ccff>{teamName}</color> garantiu uma crate ({container.ShortPrefabName}) (+{points}).");
        }

        private static readonly string[] TurretNames = { "autoturret_deployed", "flameturret.deployed", "guntrap.deployed" };
        private static readonly string[] BannedNearTurret = { "xmas.lightstring.deployed", "xmas.advanced.lights.deployed" };

        // Limites por time (regulamento): 1 auto turret, 1 flame turret e 1 shotgun trap. O excedente é removido ao ser colocado.
        private static readonly Dictionary<string, int> DeployableLimits = new Dictionary<string, int>
        {
            { "autoturret_deployed", 1 },
            { "flameturret.deployed", 1 },
            { "guntrap.deployed", 1 },
        };

        private void OnEntityBuilt(Planner planner, GameObject go)
        {
            var entity = go?.ToBaseEntity();
            if (entity == null) return;

            // Regra do regulamento: o TC fica atrás de porta, janela ou alçapão. Durante o evento, TC sem entrada por perto é removido.
            // Regra do regulamento: nada de enfeite de Natal em torre, nem persiana atrás do TC.
            // shortcut: checagem por distância (2 m para torre, 2,5 m para TC); não distingue janela de frente da persiana.
            if (BannedNearTurret.Contains(entity.ShortPrefabName) && UnityEngine.Object.FindObjectsOfType<BaseEntity>()
                .Any(t => TurretNames.Contains(t.ShortPrefabName) && Vector3.Distance(t.transform.position, entity.transform.position) <= 2f))
            {
                planner?.GetOwnerPlayer()?.ChatMessage(Prefix + "Enfeites de Natal não podem ficar em torres. A colocação foi removida.");
                entity.Kill();
                return;
            }
            if (entity.ShortPrefabName.StartsWith("shutter.") && phase != "parado" && phase != "fim" && UnityEngine.Object.FindObjectsOfType<BuildingPrivlidge>()
                .Any(tc => Vector3.Distance(tc.transform.position, entity.transform.position) <= 2.5f))
            {
                planner?.GetOwnerPlayer()?.ChatMessage(Prefix + "Persianas não são permitidas atrás ou ao lado do TC. A colocação foi removida.");
                entity.Kill();
                return;
            }

            // Regra do regulamento: bunker não é permitido. Aproximação: TC cercado por muitas paredes a até 3 m é removido.
            // shortcut: limiar de 16 paredes é um palpite; ajustar depois do teste em jogo.
            if (entity is BuildingPrivlidge && phase != "parado" && phase != "fim")
            {
                var walls = UnityEngine.Object.FindObjectsOfType<BaseEntity>()
                    .Count(w => w != entity && w.ShortPrefabName.Contains("wall") && Vector3.Distance(w.transform.position, entity.transform.position) <= 3f);
                if (walls >= 16)
                {
                    planner?.GetOwnerPlayer()?.ChatMessage(Prefix + "Design tipo bunker não é permitido. A colocação do TC foi removida.");
                    entity.Kill();
                    return;
                }
            }

            // Regra do regulamento: uma base por time. Um segundo TC do mesmo time é removido na colocação.
            if (entity is BuildingPrivlidge && (phase == "farm" || phase == "pvp" || phase == "raid"))
            {
                ulong tcOwner = entity.OwnerID;
                if (tcOwner == 0UL && planner?.GetOwnerPlayer() != null) tcOwner = planner.GetOwnerPlayer().userID;
                if (data.PlayerTeam.TryGetValue(tcOwner, out var tcTeamName) && data.Teams.TryGetValue(tcTeamName, out var tcTeam))
                {
                    var tcs = UnityEngine.Object.FindObjectsOfType<BuildingPrivlidge>()
                        .Count(tc => tc != entity && tcTeam.Members.Contains(tc.OwnerID));
                    if (tcs > 0)
                    {
                        planner?.GetOwnerPlayer()?.ChatMessage(Prefix + "Seu time já tem uma base (TC). Só é permitida uma base por time. A colocação foi removida.");
                        entity.Kill();
                        return;
                    }
                }
            }

            if (entity is BuildingPrivlidge && (phase == "farm" || phase == "pvp" || phase == "raid") && !HasEntranceNearby(entity))
            {
                if (GeometryViolation(entity, planner?.GetOwnerPlayer(), "O TC deve ficar logo atrás de uma porta, janela ou alçapão.")) return;
            }

            // Geometria: caminho livre até o TC e TC selado.
            if (entity is BuildingPrivlidge && phase != "parado" && phase != "fim")
            {
                if (PathBlocked(entity) && GeometryViolation(entity, planner?.GetOwnerPlayer(), "O caminho até o TC está bloqueado por parede ou fundação.")) return;
                if (TcSealed(entity) && GeometryViolation(entity, planner?.GetOwnerPlayer(), "TC selado não é permitido.")) return;
            }

            // Geometria: parede em fundação extra (sem TC da equipe por perto).
            if (entity.ShortPrefabName.Contains("wall") && phase != "parado" && phase != "fim" && WallOnExtraFoundation(entity))
            {
                if (GeometryViolation(entity, planner?.GetOwnerPlayer(), "Parede em fundação extra não é permitida.")) return;
            }

            // Geometria: limites de compound (china walls) e de barricada metálica por time.
            // shortcut: 12 china walls e 6 barricadas são limites heurísticos; ajustar com os números do teste em jogo.
            if ((entity.ShortPrefabName == "wall.external.high.china" || entity.ShortPrefabName == "barricade.metal") && phase != "parado" && phase != "fim")
            {
                ulong geoOwner = entity.OwnerID;
                if (geoOwner == 0UL && planner?.GetOwnerPlayer() != null) geoOwner = planner.GetOwnerPlayer().userID;
                if (data.PlayerTeam.TryGetValue(geoOwner, out var geoTeamName) && data.Teams.TryGetValue(geoTeamName, out var geoTeam))
                {
                    int limitGeo = entity.ShortPrefabName == "barricade.metal" ? 6 : 12;
                    int geoCount = UnityEngine.Object.FindObjectsOfType<BaseEntity>()
                        .Count(e => e.ShortPrefabName == entity.ShortPrefabName && geoTeam.Members.Contains(e.OwnerID));
                    if (geoCount > limitGeo && GeometryViolation(entity, planner?.GetOwnerPlayer(), $"Limite de {limitGeo} {entity.ShortPrefabName} por time atingido.")) return;
                }
            }

            if (!DeployableLimits.TryGetValue(entity.ShortPrefabName, out var limit)) return;

            var builder = planner?.GetOwnerPlayer();
            ulong ownerId = entity.OwnerID;
            if (ownerId == 0UL && builder != null) ownerId = builder.userID;
            if (!data.PlayerTeam.TryGetValue(ownerId, out var teamName) || !data.Teams.TryGetValue(teamName, out var team)) return;

            // shortcut: conta as entidades por OwnerID no momento da colocação; não cobre a entidade se o servidor reatribuir o dono depois.
            var count = UnityEngine.Object.FindObjectsOfType<BaseEntity>()
                .Count(e => e.ShortPrefabName == entity.ShortPrefabName && team.Members.Contains(e.OwnerID));
            if (count <= limit) return;

            entity.Kill();
            builder?.ChatMessage(Prefix + $"Limite de {limit} por time atingido para este item: foi removido.");
        }

        // Aproximação da regra do TC atrás de entrada: procura porta, janela ou alçapão a até 2,5 m do TC.
        // shortcut: não verifica o caminho livre nem a posição exata atrás da entrada; ajustar depois do teste em jogo.
        private bool HasEntranceNearby(BaseEntity tc)
        {
            return UnityEngine.Object.FindObjectsOfType<BaseEntity>().Any(e =>
                e != tc
                && (e.ShortPrefabName.Contains("door") || e.ShortPrefabName.Contains("window") || e.ShortPrefabName.Contains("hatch"))
                && Vector3.Distance(e.transform.position, tc.transform.position) <= 2.5f);
        }

        private bool IsSameTeam(ulong a, ulong b)
        {
            return data.PlayerTeam.TryGetValue(a, out var ta)
                && data.PlayerTeam.TryGetValue(b, out var tb)
                && ta == tb;
        }

        // shortcut: defesa de raid (até +40) ainda não pontua. Próximo passo: medir o tempo de raid por TC e somar ao defensor.

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
