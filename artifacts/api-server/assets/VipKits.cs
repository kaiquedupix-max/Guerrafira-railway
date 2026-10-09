using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Facepunch;
using Oxide.Game.Rust.Cui;
using Oxide.Core;
using Oxide.Core.Plugins;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("VipKits", "Guerra Fria", "2.1.0")]
    [Description("Menu de kits com permissoes e cooldown persistente.")]
    public class VipKits : RustPlugin
    {
        private const string BLUEPRINT_BASE = "blueprintbase";
        private const string Ui = "VipKits.Menu";
        private const string FormUi = "VipKits.Creator";
        private readonly HashSet<ulong> availableTab = new HashSet<ulong>();
        private readonly Dictionary<ulong, Draft> drafts = new Dictionary<ulong, Draft>();
        private class Draft
        {
            public string Token = Guid.NewGuid().ToString("N");
            public string EditingId;
            public bool DeleteRequested;
            public string Id = "vip1";
            public string Name = "VIP Bronze";
            public string Group = "vip1";
            public string Cooldown = "24h";
            public string WipeDelay = "0";
            public string ImageUrl = "";
            [JsonProperty(ObjectCreationHandling = ObjectCreationHandling.Replace)]
            public List<Reward> Items = new List<Reward>();
        }
        [PluginReference] private Plugin PlayerDLCAPI;
        private static Func<BasePlayer,ulong,bool> canUseSkin;
        private static Func<BasePlayer,int,int> redirectItem;
        private Settings settings;
        private string logoPng;
        private Dictionary<string, Dictionary<string, double>> claims = new Dictionary<string, Dictionary<string, double>>();
        private Dictionary<string, Dictionary<string, int>> uses = new Dictionary<string, Dictionary<string, int>>();
        private class ClaimState { public Dictionary<string, Dictionary<string,double>> Cooldowns; public Dictionary<string,Dictionary<string,int>> Uses; }
        private bool claimsLoaded;
        private readonly HashSet<ulong> busy = new HashSet<ulong>();
        private class Settings
        {
            public bool WipePlayerData = false;
            public bool OwnedSkins = false;
            public string Title = "KITS DO SERVIDOR";
            public string StoreUrl = "https://guerrafriarust.com.br/loja";
            public string PurchaseMessage = "Compre seu VIP ou presenteie um amigo na loja oficial Guerra Fria.";
            [JsonProperty(ObjectCreationHandling = ObjectCreationHandling.Replace)]
            public List<Kit> Kits = new List<Kit>
            {
                new Kit { Id = "iniciante", Name = "Iniciante", Permission = "", CooldownSeconds = 86400,
                    Items = new List<Reward> { new Reward { Shortname = "wood", Amount = 1000 }, new Reward { Shortname = "stones", Amount = 1000 } } },
                new Kit { Id = "vip", Name = "VIP", Permission = "vipkits.vip", CooldownSeconds = 86400,
                    Items = new List<Reward> { new Reward { Shortname = "wood", Amount = 5000 }, new Reward { Shortname = "metal.fragments", Amount = 1000 } } }
            };
        }
        private class Kit
        {
            public int MaximumUses = 0;
            public int RequiredAuth = 0;
            public bool Hidden = false;
            public string Description = "";
            public string StoreTier = "";
            public string Id;
            public string Name;
            public string Permission = "";
            public string PurchaseUrl = "";
            public string ImageUrl = "";
            public int CooldownSeconds = 86400;
            public int WipeDelaySeconds = 0;
            [JsonProperty(ObjectCreationHandling = ObjectCreationHandling.Replace)]
            public List<Reward> Items = new List<Reward>();
        }
        private class Reward
        {
            public string Shortname;
            public int Amount = 1;
            public ulong Skin;
            public string IncludedIn = "";
            public string Inventory = "main";
            public ItemData Serialized;
        }
        protected override void LoadDefaultConfig() { settings = new Settings(); }
        protected override void LoadConfig()
        {
            base.LoadConfig();
            try
            {
                settings = Config.ReadObject<Settings>();
                if (settings == null || settings.Kits == null) throw new Exception("Config vazia");
                if (settings.Kits.Any(k => k == null || string.IsNullOrWhiteSpace(k.Id))) throw new Exception("Kit sem ID na configuracao.");
                var clean = settings.Kits.GroupBy(k => k.Id, StringComparer.Ordinal).Select(group => group.Last()).ToList();
                if (clean.Count != settings.Kits.Count)
                {
                    string backup = Name + "/ConfigBackup_" + DateTime.UtcNow.ToString("yyyyMMdd_HHmmss_fff");
                    Interface.Oxide.DataFileSystem.WriteObject(backup, settings);
                    PrintWarning("IDs duplicados removidos. Mantida a ultima definicao de cada ID. Backup: " + backup);
                    settings.Kits = clean;
                    SaveConfig();
                }
            }
            catch (Exception ex) { PrintError("Configuracao invalida: " + ex.Message); throw; }
        }
        protected override void SaveConfig() { Config.WriteObject(settings, true); }
        private List<Reward> DisplayRewards(Kit kit) {
            var result = new List<Reward>();
            foreach (var reward in kit.Items) {
                result.Add(reward);
                if (reward.Serialized != null) AddAttachments(result, reward.Serialized, reward.Shortname, 0);
            }
            return result;
        }
        private void AddAttachments(List<Reward> result, ItemData data, string parent, int depth) {
            if (depth > 8) return;
            var nested = data.Container != null ? data.Container.contents : data.Contents == null ? null : data.Contents.ToList();
            if (nested == null) return;
            foreach (var item in nested) {
                result.Add(new Reward { Shortname = item.Shortname, Amount = item.Amount, Skin = item.Skin, Inventory = "attachment", IncludedIn = parent, Serialized = item });
                AddAttachments(result, item, item.Shortname, depth + 1);
            }
        }
        private string StoreTier(Kit kit)
        {
            string explicitTier = (kit.StoreTier ?? "").Trim().ToLowerInvariant();
            if (explicitTier == "bronze" || explicitTier == "prata" || explicitTier == "ouro") return explicitTier;
            string value = ((kit.Id ?? "") + " " + (kit.Name ?? "") + " " + (kit.Permission ?? "")).ToLowerInvariant();
            if (value.Contains("bronze") || System.Text.RegularExpressions.Regex.IsMatch(value, @"\bvip1\b")) return "bronze";
            if (value.Contains("prata") || System.Text.RegularExpressions.Regex.IsMatch(value, @"\bvip2\b")) return "prata";
            if (value.Contains("ouro") || System.Text.RegularExpressions.Regex.IsMatch(value, @"\bvip3\b")) return "ouro";
            return "";
        }
        private string StoreArt(Kit kit)
        {
            if (!string.IsNullOrWhiteSpace(kit.ImageUrl) && WebUrl(kit.ImageUrl)) return kit.ImageUrl;
            string tier = StoreTier(kit);
            return string.IsNullOrEmpty(tier) ? "" : "https://www.guerrafriarust.com.br/api/store/art/vip-" + tier;
        }
        // RCON reads the live configuration. No player identities or cooldown history are exported.
        [ConsoleCommand("vipkits.catalog")]
        private void StoreCatalog(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && arg.Connection.authLevel < 2) return;
            arg.ReplyWith(JsonConvert.SerializeObject(new {
                version = 2, generatedAt = DateTime.UtcNow.ToString("o"),
                kits = settings.Kits.Select(k => new {
                    id = k.Id, name = k.Name, tier = StoreTier(k), cooldownSeconds = k.CooldownSeconds,
                    wipeDelaySeconds = k.WipeDelaySeconds,
                    items = DisplayRewards(k).Select(r => { var def = ItemManager.FindItemDefinition(r.Shortname); return new {
                        shortname = r.Shortname, amount = r.Amount, skin = r.Skin.ToString(), inventory = r.Inventory, includedIn = r.IncludedIn, loadedAmmo = r.Serialized == null ? 0 : r.Serialized.Ammo, ammoType = r.Serialized == null ? "" : r.Serialized.Ammotype,
                        itemId = def == null ? 0 : def.itemid, name = def == null ? r.Shortname : def.displayName.english, category = def == null ? "Resources" : def.category.ToString()
                    }; }).ToArray()
                }).ToArray()
            }));
        }
        private void Init()
        {
            canUseSkin = (p, skin) => skin == 0 || !settings.OwnedSkins || PlayerDLCAPI == null || PlayerDLCAPI.Call<bool>("IsOwnedOrFreeSkin", p, skin);
            redirectItem = (p, id) => !settings.OwnedSkins || PlayerDLCAPI == null ? id : PlayerDLCAPI.Call<int>("GetRedirectedItemIdIfNotOwned", p, id);
            LoadClaims();
            var ids = new HashSet<string>();
            foreach (var kit in settings.Kits)
            {
                if (kit == null || string.IsNullOrWhiteSpace(kit.Id) || !System.Text.RegularExpressions.Regex.IsMatch(kit.Id, "^[a-z0-9_-]+$") || !ids.Add(kit.Id) || kit.Items == null || kit.Items.Count == 0 || kit.Items.Any(r => r == null || string.IsNullOrWhiteSpace(r.Shortname) || r.Amount <= 0) || kit.CooldownSeconds < 0 || kit.WipeDelaySeconds < 0)
                    throw new Exception("Kit invalido: verifique IDs unicos, itens e cooldown.");
                if (!string.IsNullOrWhiteSpace(kit.Permission))
                {
                    if (!kit.Permission.StartsWith("vipkits.", StringComparison.Ordinal) && !kit.Permission.StartsWith("kits.", StringComparison.Ordinal)) throw new Exception("Namespace de permissao de kit invalido.");
                    if (!permission.PermissionExists(kit.Permission)) permission.RegisterPermission(kit.Permission, this);
                }
            }

        }
        private void LoadClaims()
        {
            if (claimsLoaded) return;
            try
            {
                var raw = Interface.Oxide.DataFileSystem.ReadObject<JObject>(Name);
                if (raw != null && raw["Cooldowns"] != null) {
                    var state = raw.ToObject<ClaimState>();
                    claims = state.Cooldowns ?? new Dictionary<string, Dictionary<string,double>>();
                    uses = state.Uses ?? new Dictionary<string, Dictionary<string,int>>();
                } else claims = raw == null ? new Dictionary<string, Dictionary<string,double>>() : raw.ToObject<Dictionary<string, Dictionary<string,double>>>();
                claimsLoaded = true;
            }
            catch (Exception ex)
            {
                PrintError("Nao foi possivel ler os cooldowns. Dados preservados; resgates bloqueados: " + ex.Message);
            }
        }
        private void OnServerInitialized()
        {
            LoadClaims();
            var path = System.IO.Path.Combine(Interface.Oxide.DataDirectory, "VipKits", "guerraria.png");
            if (!System.IO.File.Exists(path))
            { PrintWarning("Logo ausente. Copie guerraria.png para: " + path); return; }
            try
            {
                logoPng = FileStorage.server.Store(System.IO.File.ReadAllBytes(path), FileStorage.Type.png, CommunityEntity.ServerInstance.net.ID).ToString();
            }
            catch (Exception ex) { PrintError("Falha ao carregar logo: " + ex.Message); }
        }
        private void OnNewSave(string filename) {
            if (!settings.WipePlayerData || !claimsLoaded) return;
            Interface.Oxide.DataFileSystem.WriteObject(Name + "/BeforeWipe_" + DateTime.UtcNow.ToString("yyyyMMdd_HHmmss"), new ClaimState { Cooldowns = claims, Uses = uses });
            claims.Clear(); uses.Clear(); SaveData();
        }
        [ConsoleCommand("vipkits.audit")]
        private void Audit(ConsoleSystem.Arg arg) {
            if (arg.Connection != null && arg.Connection.authLevel < 2) return;
            arg.ReplyWith(JsonConvert.SerializeObject(new { version = "2.1.0", loaded = claimsLoaded, kits = settings.Kits.Count, items = settings.Kits.Sum(k => k.Items.Count), players = claims.Count, cooldowns = claims.Values.Sum(v => v.Count), usageEntries = uses.Values.Sum(v => v.Count), totalUses = uses.Values.Sum(v => v.Values.Sum()), permissions = settings.Kits.Select(k => new { kit = k.Id, permission = k.Permission, groups = string.IsNullOrEmpty(k.Permission) ? new string[0] : permission.GetPermissionGroups(k.Permission) }).ToArray() }));
        }
        private bool LimitReached(BasePlayer p, Kit k) { Dictionary<string,int> u; int n; return k.MaximumUses > 0 && uses.TryGetValue(p.UserIDString,out u) && u.TryGetValue(k.Id,out n) && n >= k.MaximumUses; }
        private void OnServerSave() { SaveData(); }
        private void SaveData() { if (claimsLoaded && claims != null) Interface.Oxide.DataFileSystem.WriteObject(Name, new ClaimState { Cooldowns = claims, Uses = uses }); }
        private void Unload() { SaveData(); foreach (var p in BasePlayer.activePlayerList) { CuiHelper.DestroyUi(p, Ui); CuiHelper.DestroyUi(p, FormUi); } drafts.Clear(); availableTab.Clear(); }
        private void OnPlayerDisconnected(BasePlayer player, string reason) { CuiHelper.DestroyUi(player, Ui); CuiHelper.DestroyUi(player, FormUi); drafts.Remove(player.userID); availableTab.Remove(player.userID); }
        private bool Allowed(BasePlayer p, Kit k) { return p != null && p.net.connection.authLevel >= k.RequiredAuth && (string.IsNullOrWhiteSpace(k.Permission) || permission.UserHasPermission(p.UserIDString, k.Permission)); }
        private double Now() { return DateTime.UtcNow.Subtract(new DateTime(1970, 1, 1)).TotalSeconds; }
        private double Remaining(BasePlayer p, Kit k)
        {
            Dictionary<string, double> user; double until;
            if (p == null || k == null || claims == null) return 0;
            if (!claims.TryGetValue(p.UserIDString, out user) || user == null || !user.TryGetValue(k.Id, out until)) return 0;
            return double.IsNaN(until) || double.IsInfinity(until) ? 0 : Math.Max(0, until - Now());
        }
        private string WaitText(double seconds)
        {
            var t = TimeSpan.FromSeconds(Math.Ceiling(seconds));
            return t.TotalHours >= 1 ? string.Format("{0}h {1}min", (int)t.TotalHours, t.Minutes) : string.Format("{0}min {1}s", t.Minutes, t.Seconds);
        }
        private double WipeRemaining(Kit kit)
        {
            if (kit.WipeDelaySeconds == 0) return 0;
            // Rust exposes the map save creation time in UTC, even on plugin reload.
            var created = SaveRestore.SaveCreatedTime;
            var utc = created.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(created, DateTimeKind.Utc) : created.ToUniversalTime();
            return Math.Max(0, (utc - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds + kit.WipeDelaySeconds - Now());
        }
        private bool IsOwner(BasePlayer p) { return p != null && ServerUsers.Is(p.userID, ServerUsers.UserGroup.Owner); }
        private bool Admin(BasePlayer p)
        {
            if (IsOwner(p)) return true;
            p.ChatMessage("Somente jogadores cadastrados como ownerid podem gerenciar kits."); return false;
        }
        private bool Duration(string input, out int seconds)
        {
            seconds = 0;
            if (string.IsNullOrWhiteSpace(input)) return false;
            input = input.Trim().ToLowerInvariant();
            double factor = 1;
            char unit = input[input.Length - 1];
            if (char.IsLetter(unit))
            {
                switch (unit) { case 's': factor = 1; break; case 'm': factor = 60; break; case 'h': factor = 3600; break; case 'd': factor = 86400; break; default: return false; }
                input = input.Substring(0, input.Length - 1);
            }
            double value;
            if (!double.TryParse(input.Replace(',', '.'), System.Globalization.NumberStyles.AllowDecimalPoint, System.Globalization.CultureInfo.InvariantCulture, out value)) return false;
            value *= factor;
            if (double.IsNaN(value) || double.IsInfinity(value) || value < 0 || value > 31536000) return false;
            seconds = (int)Math.Ceiling(value); return true;
        }
        [ChatCommand("kitcooldown")]
        private void SetCooldown(BasePlayer p, string command, string[] args) { SetTime(p, args, false); }
        [ChatCommand("kitwipe")]
        private void SetWipeDelay(BasePlayer p, string command, string[] args) { SetTime(p, args, true); }
        private void SetTime(BasePlayer p, string[] args, bool wipe)
        {
            if (!Admin(p)) return;
            int seconds;
            if (args.Length != 2 || !Duration(args[1], out seconds))
            { p.ChatMessage("Use /" + (wipe ? "kitwipe" : "kitcooldown") + " ID TEMPO. Exemplos: 30m, 2h, 1d, 0. Maximo: 365d."); return; }
            var kit = settings.Kits.FirstOrDefault(k => k.Id == args[0]);
            if (kit == null) { p.ChatMessage("Kit nao encontrado: " + args[0]); return; }
            if (wipe) kit.WipeDelaySeconds = seconds;
            else
            {
                int old = kit.CooldownSeconds;
                foreach (var user in claims.Values.Where(value => value != null))
                {
                    double until;
                    if (user.TryGetValue(kit.Id, out until)) user[kit.Id] = until - old + seconds;
                }
                kit.CooldownSeconds = seconds; SaveData();
            }
            SaveConfig();
            p.ChatMessage(kit.Name + ": " + (wipe ? "liberacao apos wipe" : "cooldown") + " = " + (seconds == 0 ? "desativado" : WaitText(seconds)) + ".");
            Show(p, 0);
        }
        [ChatCommand("kittempo")]
        private void KitTime(BasePlayer p, string command, string[] args)
        {
            if (!Admin(p)) return;
            var kit = args.Length == 1 ? settings.Kits.FirstOrDefault(k => k.Id == args[0]) : null;
            if (kit == null) { p.ChatMessage("Use /kittempo ID de um kit existente."); return; }
            p.ChatMessage(kit.Name + " | cooldown: " + WaitText(kit.CooldownSeconds) + " | liberacao apos wipe: " + WaitText(kit.WipeDelaySeconds)
                + " | bloqueio restante: " + WaitText(WipeRemaining(kit)) + " | inicio do mapa (UTC): " + SaveRestore.SaveCreatedTime.ToString("yyyy-MM-dd HH:mm:ss"));
        }
        [ConsoleCommand("vipkits.create")]
        private void CreateFromMenu(ConsoleSystem.Arg arg)
        {
            var player = arg.Player(); if (player != null) OpenCreator(player, "kitcriar", new string[0]);
        }
        private List<Reward> Capture(BasePlayer p)
        {
            return p.inventory.containerMain.itemList.Concat(p.inventory.containerBelt.itemList)
                .Concat(p.inventory.containerWear.itemList)
                .Select(item => new Reward { Shortname = item.info.shortname, Amount = item.amount, Skin = item.skin, Inventory = item.parent == p.inventory.containerBelt ? "belt" : item.parent == p.inventory.containerWear ? "wear" : "main", Serialized = new ItemData(item) }).ToList();
        }
        [ChatCommand("kitcriar")]
        private void OpenCreator(BasePlayer p, string command, string[] args)
        {
            if (!Admin(p)) return;
            var d = new Draft();
            if (args.Length > 1) { p.ChatMessage("Use /kitcriar para criar, ou /kitcriar ID para editar."); return; }
            if (args.Length == 1)
            {
                var kit = settings.Kits.FirstOrDefault(k => k.Id == args[0]);
                if (kit == null) { p.ChatMessage("Kit nao encontrado. Use /kitcriar para criar um novo."); return; }
                d.EditingId = kit.Id; d.Id = kit.Id; d.Name = kit.Name; d.Group = "";
                d.Cooldown = kit.CooldownSeconds + "s"; d.WipeDelay = kit.WipeDelaySeconds + "s"; d.ImageUrl = kit.ImageUrl ?? "";
                d.Items = JsonConvert.DeserializeObject<List<Reward>>(JsonConvert.SerializeObject(kit.Items));
            }
            else
            {
                if (settings.Kits.Any(k => k.Id == d.Id)) { d.Id = "kit_" + DateTime.UtcNow.ToString("yyyyMMdd_HHmmss"); d.Name = "Novo kit"; d.Group = ""; }
                d.Items = Capture(p);
            }
            drafts[p.userID] = d; ShowCreator(p, d);
        }
        private void FormLabel(CuiElementContainer c, string text, string min, string max, int size = 15)
        {
            c.Add(new CuiLabel { Text = { Text = text, FontSize = size, Align = TextAnchor.MiddleLeft }, RectTransform = { AnchorMin = min, AnchorMax = max } }, FormUi);
        }
        private void FormButton(CuiElementContainer c, string text, string command, string min, string max, string color)
        {
            c.Add(new CuiButton { Button = { Color = color, Command = command }, Text = { Text = text, FontSize = 14, Align = TextAnchor.MiddleCenter }, RectTransform = { AnchorMin = min, AnchorMax = max } }, FormUi);
        }
        private void FormInput(CuiElementContainer c, Draft d, string field, string title, string value, float top, int limit, bool readOnly = false)
        {
            string y1 = (top - 0.055f).ToString(System.Globalization.CultureInfo.InvariantCulture);
            string y2 = top.ToString(System.Globalization.CultureInfo.InvariantCulture);
            FormLabel(c, title, "0.05 " + y1, "0.41 " + y2);
            string panel = FormUi + "." + field;
            c.Add(new CuiPanel { Image = { Color = "0.14 0.16 0.18 1" }, RectTransform = { AnchorMin = "0.43 " + y1, AnchorMax = "0.95 " + y2 } }, FormUi, panel);
            c.Add(new CuiElement { Parent = panel, Components = {
                new CuiInputFieldComponent { Text = value, FontSize = 16, Align = TextAnchor.MiddleLeft, Color = "1 1 1 1", CharsLimit = limit, ReadOnly = readOnly, NeedsKeyboard = true, Command = "vipkits.form " + d.Token + " " + field },
                new CuiRectTransformComponent { AnchorMin = "0.02 0", AnchorMax = "0.98 1" }
            }});
        }
        private void ShowCreator(BasePlayer p, Draft d)
        {
            if (!IsOwner(p)) return;
            d.DeleteRequested = false;
            CuiHelper.DestroyUi(p, Ui); CuiHelper.DestroyUi(p, FormUi);
            var c = new CuiElementContainer();
            c.Add(new CuiPanel { Image = { Color = "0.035 0.045 0.035 0.99" }, RectTransform = { AnchorMin = "0.5 0.5", AnchorMax = "0.5 0.5", OffsetMin = "-440 -360", OffsetMax = "440 360" }, CursorEnabled = true, KeyboardEnabled = true }, "Overlay", FormUi);
            FormLabel(c, d.EditingId == null ? "CRIAR KIT" : "EDITAR KIT", "0.05 0.91", "0.95 0.98", 24);
            FormLabel(c, "Preencha cada campo e pressione ENTER para confirmar o valor.", "0.05 0.85", "0.95 0.9", 13);
            FormInput(c, d, "id", "ID (ex.: vip1)", d.Id, 0.82f, 40, d.EditingId != null);
            FormInput(c, d, "name", "Nome na interface", d.Name, 0.745f, 60);
            FormInput(c, d, "group", "Grupo existente (opcional)", d.Group, 0.67f, 80);
            FormInput(c, d, "cooldown", "Cooldown entre resgates", d.Cooldown, 0.595f, 20);
            FormInput(c, d, "wipe", "Liberar quanto tempo apos wipe", d.WipeDelay, 0.52f, 20);
            FormInput(c, d, "image", "URL direta da imagem", d.ImageUrl, 0.445f, 1024);
            FormLabel(c, "Tempos: 30m, 2h, 1d. 0 desativa. Limite: 365d.\nGrupo vazio: conceda a permissao depois. Itens originais preservados.", "0.05 0.32", "0.95 0.385", 13);
            string list = d.Items.Count == 0 ? "Nenhum item capturado." : string.Join("\n", d.Items.Take(4).Select(r => r.Amount + "x " + r.Shortname).ToArray());
            if (d.Items.Count > 4) list += "\n... e mais " + (d.Items.Count - 4) + " itens.";
            FormLabel(c, "Itens capturados: " + d.Items.Count + "\n" + list, "0.05 0.12", "0.65 0.305", 13);
            FormButton(c, "ATUALIZAR ITENS", "vipkits.capture " + d.Token, "0.67 0.24", "0.95 0.34", "0.3 0.35 0.4 1");
            if (d.EditingId != null) FormButton(c, "APAGAR KIT", "vipkits.delete " + d.Token, "0.67 0.12", "0.95 0.21", "0.62 0.16 0.18 1");
            FormButton(c, "SALVAR KIT", "vipkits.save " + d.Token, "0.54 0.03", "0.95 0.1", "0.18 0.48 0.22 1");
            FormButton(c, "CANCELAR", "vipkits.cancel " + d.Token, "0.05 0.03", "0.46 0.1", "0.55 0.2 0.2 1");
            CuiHelper.AddUi(p, c);
        }
        private bool GetDraft(ConsoleSystem.Arg arg, out BasePlayer p, out Draft d)
        {
            p = arg.Player(); d = null;
            return IsOwner(p) && arg.Args != null && arg.Args.Length > 0
                && drafts.TryGetValue(p.userID, out d) && arg.Args[0].ToString() == d.Token;
        }
        [ConsoleCommand("vipkits.form")]
        private void FormValue(ConsoleSystem.Arg arg)
        {
            BasePlayer p; Draft d;
            if (!GetDraft(arg, out p, out d) || arg.Args.Length < 2) return;
            string value = string.Join(" ", arg.Args.Skip(2).Select(argument => argument.ToString()).ToArray()).Trim();
            if (value.Any(ch => char.IsControl(ch) || ch == '<' || ch == '>')) { p.ChatMessage("Remova caracteres especiais do campo."); return; }
            switch (arg.Args[1].ToString())
            {
                case "id": if (d.EditingId == null && value.Length <= 40) d.Id = value; break;
                case "name": if (value.Length <= 60) d.Name = value; break;
                case "group": if (value.Length <= 80) d.Group = value; break;
                case "cooldown": if (value.Length <= 20) d.Cooldown = value; break;
                case "wipe": if (value.Length <= 20) d.WipeDelay = value; break;
                case "image": if (value.Length <= 1024) d.ImageUrl = value; break;
                default: return;
            }
        }
        [ConsoleCommand("vipkits.capture")]
        private void CaptureForm(ConsoleSystem.Arg arg)
        {
            BasePlayer p; Draft d; if (!GetDraft(arg, out p, out d)) return;
            d.Items = Capture(p); ShowCreator(p, d);
        }
        [ConsoleCommand("vipkits.cancel")]
        private void CancelForm(ConsoleSystem.Arg arg)
        {
            BasePlayer p; Draft d; if (!GetDraft(arg, out p, out d)) return;
            drafts.Remove(p.userID); CuiHelper.DestroyUi(p, FormUi); Show(p, 0);
        }
        [ConsoleCommand("vipkits.delete")]
        private void RequestDelete(ConsoleSystem.Arg arg)
        {
            BasePlayer p; Draft d;
            if (!GetDraft(arg, out p, out d) || arg.Args.Length != 1 || d.EditingId == null) return;
            var kit = settings.Kits.FirstOrDefault(k => k.Id == d.EditingId);
            if (kit == null) { p.ChatMessage("Este kit ja foi apagado."); return; }
            d.DeleteRequested = true;
            string modal = FormUi + ".Delete";
            string box = modal + ".Box";
            CuiHelper.DestroyUi(p, modal);
            var c = new CuiElementContainer();
            c.Add(new CuiPanel { Image = { Color = "0.02 0.025 0.035 0.98" }, RectTransform = { AnchorMin = "0 0", AnchorMax = "1 1" }, CursorEnabled = true }, FormUi, modal);
            c.Add(new CuiPanel { Image = { Color = "0.09 0.105 0.135 1" }, RectTransform = { AnchorMin = "0.5 0.5", AnchorMax = "0.5 0.5", OffsetMin = "-310 -125", OffsetMax = "310 125" } }, modal, box);
            CardText(c, box, "APAGAR KIT?", "0.07 0.72", "0.93 0.93", 24, "0.96 0.5 0.45 1", TextAnchor.MiddleCenter);
            CardText(c, box, kit.Name + " (" + kit.Id + ")", "0.07 0.52", "0.93 0.7", 18, "0.95 0.96 0.98 1", TextAnchor.MiddleCenter);
            CardText(c, box, "O kit e seu historico de cooldown serao removidos.", "0.07 0.34", "0.93 0.51", 14, "0.65 0.72 0.8 1", TextAnchor.MiddleCenter);
            CardButton(c, box, "VOLTAR", "vipkits.deletecancel " + d.Token, "0.07 0.08", "0.47 0.26", "0.2 0.24 0.3 1");
            CardButton(c, box, "CONFIRMAR EXCLUSAO", "vipkits.deleteconfirm " + d.Token, "0.53 0.08", "0.93 0.26", "0.65 0.17 0.18 1");
            CuiHelper.AddUi(p, c);
        }
        [ConsoleCommand("vipkits.deletecancel")]
        private void CancelDelete(ConsoleSystem.Arg arg)
        {
            BasePlayer p; Draft d;
            if (!GetDraft(arg, out p, out d) || arg.Args.Length != 1) return;
            d.DeleteRequested = false;
            CuiHelper.DestroyUi(p, FormUi + ".Delete");
        }
        [ConsoleCommand("vipkits.deleteconfirm")]
        private void ConfirmDelete(ConsoleSystem.Arg arg)
        {
            BasePlayer p; Draft d;
            if (!GetDraft(arg, out p, out d) || arg.Args.Length != 1 || !d.DeleteRequested || d.EditingId == null) return;
            var kit = settings.Kits.FirstOrDefault(k => k.Id == d.EditingId);
            if (kit == null) { p.ChatMessage("Este kit ja foi apagado."); return; }
            string backup = Name + "/DeletedKits/" + kit.Id + "_" + DateTime.UtcNow.ToString("yyyyMMdd_HHmmss_fff");
            Interface.Oxide.DataFileSystem.WriteObject(backup, kit);
            int index = settings.Kits.IndexOf(kit);
            settings.Kits.RemoveAt(index);
            try { SaveConfig(); }
            catch { settings.Kits.Insert(index, kit); throw; }
            foreach (var user in claims.Values.Where(value => value != null)) user.Remove(kit.Id);
            SaveData();
            foreach (var playerId in drafts.Where(entry => entry.Value.EditingId == kit.Id).Select(entry => entry.Key).ToList()) drafts.Remove(playerId);
            CuiHelper.DestroyUi(p, FormUi);
            p.ChatMessage("Kit apagado: " + kit.Name + ". Backup salvo em data/" + backup + ".json.");
            Show(p, 0);
        }
        [ConsoleCommand("vipkits.save")]
        private void SaveForm(ConsoleSystem.Arg arg)
        {
            BasePlayer p; Draft d; if (!GetDraft(arg, out p, out d)) return;
            int cooldown, wipe;
            if (string.IsNullOrWhiteSpace(d.Id) || !System.Text.RegularExpressions.Regex.IsMatch(d.Id, "^[a-z0-9_-]+$") || string.IsNullOrWhiteSpace(d.Name))
            { p.ChatMessage("Preencha ID e nome. ID: letras minusculas, numeros, _ ou -. Confirme os campos com ENTER."); return; }
            if (!Duration(d.Cooldown, out cooldown) || !Duration(d.WipeDelay, out wipe))
            { p.ChatMessage("Tempo invalido. Use 30m, 2h, 1d ou 0 (ate 365d)."); return; }
            if (!string.IsNullOrWhiteSpace(d.ImageUrl) && !WebUrl(d.ImageUrl))
            { p.ChatMessage("Use uma URL http/https direta para a imagem, ou deixe vazia."); return; }
            if (d.Items.Count == 0) { p.ChatMessage("Inventario capturado vazio. Adicione itens e clique ATUALIZAR ITENS."); return; }
            if (!string.IsNullOrWhiteSpace(d.Group) && !permission.GroupExists(d.Group))
            { p.ChatMessage("Grupo inexistente: " + d.Group); return; }
            var existing = settings.Kits.FirstOrDefault(k => k.Id == d.Id);
            if ((d.EditingId == null && existing != null) || (d.EditingId != null && existing == null))
            { p.ChatMessage("Kit alterado ou ID ja existente. Reabra o formulario."); return; }
            var kit = existing ?? new Kit { Id = d.Id, Permission = "vipkits." + d.Id };
            if (existing != null)
            {
                foreach (var user in claims.Values.Where(value => value != null))
                {
                    double until;
                    if (user.TryGetValue(kit.Id, out until)) user[kit.Id] = until - kit.CooldownSeconds + cooldown;
                }
            }
            kit.Name = d.Name; kit.ImageUrl = d.ImageUrl; kit.CooldownSeconds = cooldown; kit.WipeDelaySeconds = wipe; kit.Items = d.Items;
            if (existing == null) { settings.Kits.Add(kit); permission.RegisterPermission(kit.Permission, this); }
            if (!string.IsNullOrWhiteSpace(d.Group) && !string.IsNullOrWhiteSpace(kit.Permission)) permission.GrantGroupPermission(d.Group, kit.Permission, this);
            SaveConfig(); SaveData();
            drafts.Remove(p.userID); CuiHelper.DestroyUi(p, FormUi);
            p.ChatMessage("Kit salvo: " + kit.Name + ". Permissao: " + (string.IsNullOrWhiteSpace(kit.Permission) ? "publico" : kit.Permission));
            Show(p, 0);
        }
        [ChatCommand("kit")]
        private void Open(BasePlayer player, string command, string[] args) {
            availableTab.Remove(player.userID);
            if (args.Length > 0) { string name = string.Join(" ",args); var kit = settings.Kits.FirstOrDefault(k => k.Id.Equals(name,StringComparison.OrdinalIgnoreCase) || k.Name.Equals(name,StringComparison.OrdinalIgnoreCase));
                if (kit == null) { player.ChatMessage("Kit nao encontrado."); return; } ClaimKit(player,kit,0); return;
            } Show(player,0);
        }
        [ConsoleCommand("vipkits.close")]
        private void Close(ConsoleSystem.Arg arg) { var p = arg.Player(); if (p != null) CuiHelper.DestroyUi(p, Ui); }
        [ConsoleCommand("vipkits.category")]
        private void Category(ConsoleSystem.Arg arg)
        {
            var p = arg.Player();
            if (p == null || arg.Args == null || arg.Args.Length != 1) return;
            string category = arg.Args[0].ToString();
            if (category == "available") availableTab.Add(p.userID);
            else if (category == "server") availableTab.Remove(p.userID);
            else return;
            Show(p, 0);
        }
        [ConsoleCommand("vipkits.items")]
        private void ItemDetails(ConsoleSystem.Arg arg)
        {
            var p = arg.Player(); int page;
            if (p == null || arg.Args == null || arg.Args.Length != 2 || !int.TryParse(arg.Args[1].ToString(), out page)) return;
            var kit = settings.Kits.FirstOrDefault(k => k.Id == arg.Args[0].ToString());
            if (kit == null) return;
            var displayed = DisplayRewards(kit);
            const int perPage = 10;
            int pages = Math.Max(1, (displayed.Count + perPage - 1) / perPage);
            page = Math.Max(0, Math.Min(page, pages - 1));
            string modal = Ui + ".Items";
            string box = modal + ".Box";
            CuiHelper.DestroyUi(p, modal);
            var c = new CuiElementContainer();
            c.Add(new CuiPanel { Image = { Color = "0.02 0.025 0.035 0.97" }, RectTransform = { AnchorMin = "0 0", AnchorMax = "1 1" }, CursorEnabled = true }, Ui, modal);
            c.Add(new CuiPanel { Image = { Color = "0.06 0.08 0.105 1" }, RectTransform = { AnchorMin = "0.5 0.5", AnchorMax = "0.5 0.5", OffsetMin = "-340 -285", OffsetMax = "340 285" } }, modal, box);
            PixelText(c, box, kit.Name, 28, -18, 568, 40, 23, "0.95 0.96 0.98 1", TextAnchor.MiddleLeft);
            PixelText(c, box, "LISTA COMPLETA  /  " + displayed.Count + " entradas de itens", 28, -60, 620, 27, 13, "0.73 0.61 0.33 1", TextAnchor.MiddleLeft);
            PixelButton(c, box, "X", "vipkits.itemsclose", 620, -20, 32, 32, "0.23 0.16 0.17 1", 13);
            for (int i = 0; i < perPage && page * perPage + i < displayed.Count; i++)
            {
                var reward = displayed[page * perPage + i];
                var def = ItemManager.FindItemDefinition(reward.Shortname);
                string name = def != null ? def.displayName.english : reward.Shortname;
                int top = -103 - i * 37;
                c.Add(new CuiPanel { Image = { Color = i % 2 == 0 ? "0.095 0.12 0.15 1" : "0.075 0.10 0.13 1" }, RectTransform = { AnchorMin = "0 1", AnchorMax = "0 1", OffsetMin = "28 " + (top - 33), OffsetMax = "652 " + top } }, box);
                PixelText(c, box, reward.Amount + "x", 38, top, 80, 33, 16, "0.84 0.69 0.34 1", TextAnchor.MiddleLeft);
                if (def != null) c.Add(new CuiElement { Parent = box, Components = { new CuiImageComponent { ItemId = def.itemid, SkinId = reward.Skin, Color = "1 1 1 1" }, new CuiRectTransformComponent { AnchorMin = "0 1", AnchorMax = "0 1", OffsetMin = "126 " + (top - 32), OffsetMax = "158 " + top } } });
                PixelText(c, box, name, 172, top, 292, 33, 15, "0.94 0.95 0.98 1", TextAnchor.MiddleLeft);
                PixelText(c, box, reward.Skin == 0 ? "" : "Skin: " + reward.Skin, 472, top, 166, 33, 11, "0.57 0.65 0.74 1", TextAnchor.MiddleRight);
            }
            PixelText(c, box, "PAGINA " + (page + 1) + " / " + pages, 240, -492, 200, 32, 13, "0.7 0.77 0.85 1");
            if (page > 0) PixelButton(c, box, "< ANTERIOR", "vipkits.items " + kit.Id + " " + (page - 1), 28, -492, 180, 32, "0.16 0.21 0.27 1", 12);
            if (page + 1 < pages) PixelButton(c, box, "PROXIMA >", "vipkits.items " + kit.Id + " " + (page + 1), 472, -492, 180, 32, "0.16 0.21 0.27 1", 12);
            PixelText(c, box, "Todos os itens do kit sao listados nas paginas acima.", 28, -534, 624, 22, 12, "0.52 0.62 0.71 1");
            CuiHelper.AddUi(p, c);
        }
        [ConsoleCommand("vipkits.itemsclose")]
        private void CloseItems(ConsoleSystem.Arg arg)
        {
            var p = arg.Player(); if (p != null) CuiHelper.DestroyUi(p, Ui + ".Items");
        }
        [ConsoleCommand("vipkits.page")]
        private void Page(ConsoleSystem.Arg arg)
        {
            var p = arg.Player(); int page;
            if (p != null && arg.Args != null && arg.Args.Length == 1 && int.TryParse(arg.Args[0].ToString(), out page)) Show(p, page);
        }
        private bool WebUrl(string value)
        {
            Uri url;
            return Uri.TryCreate(value, UriKind.Absolute, out url) && (url.Scheme == Uri.UriSchemeHttps || url.Scheme == Uri.UriSchemeHttp);
        }
        private void CardText(CuiElementContainer c, string parent, string text, string min, string max, int size, string color = "0.94 0.95 0.96 1", TextAnchor align = TextAnchor.UpperLeft)
        {
            c.Add(new CuiLabel { Text = { Text = text, FontSize = size, Color = color, Align = align }, RectTransform = { AnchorMin = min, AnchorMax = max } }, parent);
        }
        private void CardButton(CuiElementContainer c, string parent, string text, string command, string min, string max, string color, int size = 14)
        {
            c.Add(new CuiButton { Button = { Color = color, Command = command }, Text = { Text = text, FontSize = size, Align = TextAnchor.MiddleCenter }, RectTransform = { AnchorMin = min, AnchorMax = max } }, parent);
        }
        private void PixelText(CuiElementContainer c, string parent, string text, int x, int top, int width, int height, int size, string color, TextAnchor align = TextAnchor.MiddleCenter)
        {
            c.Add(new CuiLabel { Text = { Text = text, FontSize = size, Color = color, Align = align }, RectTransform = { AnchorMin = "0 1", AnchorMax = "0 1", OffsetMin = x + " " + (top - height), OffsetMax = (x + width) + " " + top } }, parent);
        }
        private void PixelButton(CuiElementContainer c, string parent, string text, string command, int x, int top, int width, int height, string color, int size = 14)
        {
            c.Add(new CuiButton { Button = { Color = color, Command = command }, Text = { Text = text, FontSize = size, Align = TextAnchor.MiddleCenter }, RectTransform = { AnchorMin = "0 1", AnchorMax = "0 1", OffsetMin = x + " " + (top - height), OffsetMax = (x + width) + " " + top } }, parent);
        }
        private void Show(BasePlayer p, int page)
        {
            CuiHelper.DestroyUi(p, FormUi); drafts.Remove(p.userID);
            var kits = settings.Kits.Where(k => !k.Hidden && (!availableTab.Contains(p.userID) || Allowed(p, k))).ToList();
            int pages = Math.Max(1, (kits.Count + 3) / 4);
            page = Math.Max(0, Math.Min(page, pages - 1));
            CuiHelper.DestroyUi(p, Ui);
            var c = new CuiElementContainer();
            c.Add(new CuiPanel { Image = { Color = "0.02 0.025 0.035 0.92" }, RectTransform = { AnchorMin = "0 0", AnchorMax = "1 1" }, CursorEnabled = true }, "Overlay", Ui);
            int visible = Math.Min(4, kits.Count - page * 4);
            int height = 690;
            string half = (height / 2).ToString(System.Globalization.CultureInfo.InvariantCulture);
            string main = Ui + ".Window";
            c.Add(new CuiPanel { Image = { Color = "0.055 0.07 0.09 1" }, RectTransform = { AnchorMin = "0.5 0.5", AnchorMax = "0.5 0.5", OffsetMin = "-520 -" + half, OffsetMax = "520 " + half } }, Ui, main);
            c.Add(new CuiPanel { Image = { Color = "0.075 0.09 0.115 1" }, RectTransform = { AnchorMin = "0 1", AnchorMax = "1 1", OffsetMin = "0 -197", OffsetMax = "0 0" } }, main);
            c.Add(new CuiPanel { Image = { Color = "0.85 0.65 0.25 1" }, RectTransform = { AnchorMin = "0 1", AnchorMax = "1 1", OffsetMin = "0 -3", OffsetMax = "0 0" } }, main);
            if (!string.IsNullOrEmpty(logoPng))
                c.Add(new CuiElement { Parent = main, Components = {
                    new CuiRawImageComponent { Png = logoPng, Color = "1 1 1 1" },
                    new CuiRectTransformComponent { AnchorMin = "0.5 1", AnchorMax = "0.5 1", OffsetMin = "-130 -135", OffsetMax = "130 -7" }
                }});
            else PixelText(c, main, "GUERRARIA SERVIDORES", 180, -40, 680, 85, 28, "0.85 0.65 0.25 1");
            PixelText(c, main, settings.Title, 150, -137, 740, 33, 23, "0.95 0.96 0.98 1");
            PixelText(c, main, "Escolha seu kit e aproveite os beneficios do servidor.", 150, -172, 740, 22, 13, "0.62 0.69 0.77 1");
            PixelButton(c, main, "X", "vipkits.close", 972, -20, 40, 36, "0.18 0.2 0.25 1");
            bool available = availableTab.Contains(p.userID);
            int ownedCount = settings.Kits.Count(k => Allowed(p, k));
            PixelButton(c, main, "KITS DO SERVIDOR (" + settings.Kits.Count + ")", "vipkits.category server", 32, -205, 238, 30, available ? "0.12 0.16 0.2 1" : "0.46 0.35 0.13 1", 12);
            PixelButton(c, main, "KITS DISPONIVEIS (" + ownedCount + ")", "vipkits.category available", 282, -205, 238, 30, available ? "0.16 0.4 0.29 1" : "0.12 0.16 0.2 1", 12);
            if (IsOwner(p)) PixelButton(c, main, "+ CRIAR KIT", "vipkits.create", 828, -205, 180, 30, "0.46 0.35 0.13 1", 12);
            if (kits.Count == 0) PixelText(c, main, (available ? "Voce ainda nao possui kits. Confira a aba Kits do servidor." : "Nenhum kit cadastrado."), 100, -250, 840, 190, 20, "0.7 0.76 0.83 1");
            for (int i = 0; i < 4 && page * 4 + i < kits.Count; i++)
            {
                var k = kits[page * 4 + i];
                bool allowed = Allowed(p, k); bool exhausted = LimitReached(p,k); double wipeWait = WipeRemaining(k); double wait = Math.Max(Remaining(p, k), wipeWait);
                string status = exhausted ? "LIMITE ATINGIDO" : !allowed ? "EXCLUSIVO VIP" : wait > 0 ? "LIBERA EM " + WaitText(wait) : "DISPONIVEL AGORA";
                string action = exhausted ? "LIMITE ATINGIDO" : !allowed ? "COMPRAR VIP" : wait > 0 ? "ATUALIZAR TEMPO" : "RESGATAR KIT";
                string command = exhausted ? "vipkits.page " + page : !allowed ? "vipkits.buy " + k.Id : wait > 0 ? "vipkits.page " + page : "vipkits.claim " + k.Id + " " + page;
                string accent = !allowed ? "0.77 0.55 0.15 1" : wait > 0 ? "0.42 0.48 0.55 1" : "0.23 0.66 0.42 1";
                string button = !allowed ? "0.55 0.38 0.09 1" : wait > 0 ? "0.17 0.2 0.25 1" : "0.12 0.4 0.26 1";
                string row = Ui + ".Card" + i;
                int left = 32 + i * 248;
                int top = -245;
                c.Add(new CuiPanel { Image = { Color = "0.045 0.055 0.065 1" }, RectTransform = { AnchorMin = "0 1", AnchorMax = "0 1", OffsetMin = left + " " + (top - 372), OffsetMax = (left + 232) + " " + top } }, main, row);
                c.Add(new CuiPanel { Image = { Color = "1 0.71 0.06 1" }, RectTransform = { AnchorMin = "0 0.992", AnchorMax = "1 1" } }, row);
                string image = row + ".Image";
                c.Add(new CuiPanel { Image = { Color = "0.06 0.07 0.08 1" }, RectTransform = { AnchorMin = "0.10 0.51", AnchorMax = "0.90 0.96" } }, row, image);
                string art = StoreArt(k);
                if (!string.IsNullOrEmpty(art))
                    c.Add(new CuiElement { Parent = image, Components = { new CuiRawImageComponent { Url = art, Color = "1 1 1 1" }, new CuiRectTransformComponent { AnchorMin = "0 0", AnchorMax = "1 1", OffsetMin = "0 0", OffsetMax = "0 0" } } });
                else CardText(c, image, "KIT\n" + k.Name.ToUpperInvariant(), "0.04 0.05", "0.96 0.95", 15, accent, TextAnchor.MiddleCenter);
                CardText(c, row, k.Name, "0.06 0.43", "0.94 0.51", 18, "1 1 1 1", TextAnchor.MiddleCenter);
                CardText(c, row, status, "0.05 0.37", "0.95 0.43", 10, accent, TextAnchor.MiddleCenter);
                CardButton(c, row, "VER ITENS (" + DisplayRewards(k).Count + ")", "vipkits.items " + k.Id + " 0", "0.06 0.23", "0.94 0.32", "0.14 0.17 0.19 1", 12);
                string timing = wipeWait > 0 ? "POS-WIPE: " + WaitText(wipeWait) : "COOLDOWN: " + (k.CooldownSeconds == 0 ? "SEM ESPERA" : WaitText(k.CooldownSeconds));
                CardText(c, row, timing, "0.04 0.17", "0.96 0.23", 9, "0.67 0.71 0.74 1", TextAnchor.MiddleCenter);
                CardButton(c, row, action, command, "0.06 0.06", "0.94 0.15", button, 11);
                if (IsOwner(p)) CardButton(c, row, "EDITAR", "vipkits.edit " + k.Id, "0.58 0.90", "0.94 0.97", "0.18 0.2 0.25 1", 9);
            }
            CardText(c, main, "PAGINA " + (page + 1) + " / " + pages, "0.37 0.012", "0.63 0.067", 12, "0.55 0.61 0.69 1", TextAnchor.MiddleCenter);
            if (page > 0) CardButton(c, main, "< ANTERIOR", "vipkits.page " + (page - 1), "0.035 0.016", "0.23 0.064", "0.12 0.14 0.18 1", 12);
            if (page + 1 < pages) CardButton(c, main, "PROXIMA >", "vipkits.page " + (page + 1), "0.77 0.016", "0.965 0.064", "0.12 0.14 0.18 1", 12);
            CuiHelper.AddUi(p, c);
        }
        private void Label(CuiElementContainer c, string text, string min, string max, int size) { c.Add(new CuiLabel { Text = { Text = text, FontSize = size, Align = TextAnchor.MiddleCenter }, RectTransform = { AnchorMin = min, AnchorMax = max } }, Ui); }
        private void Button(CuiElementContainer c, string text, string command, string min, string max, string color) { c.Add(new CuiButton { Button = { Color = color, Command = command }, Text = { Text = text, FontSize = 14, Align = TextAnchor.MiddleCenter }, RectTransform = { AnchorMin = min, AnchorMax = max } }, Ui); }
        [ConsoleCommand("vipkits.edit")]
        private void EditFromMenu(ConsoleSystem.Arg arg)
        {
            var p = arg.Player();
            if (p == null || arg.Args == null || arg.Args.Length != 1) return;
            OpenCreator(p, "kitcriar", arg.Args.Select(argument => argument.ToString()).ToArray());
        }
        [ConsoleCommand("vipkits.buy")]
        private void Buy(ConsoleSystem.Arg arg)
        {
            var p = arg.Player();
            if (p == null || arg.Args == null || arg.Args.Length != 1) return;
            var kit = settings.Kits.FirstOrDefault(k => k.Id == arg.Args[0].ToString());
            if (kit == null) return;
            if (Allowed(p, kit)) { Show(p, 0); return; }
            var url = string.IsNullOrWhiteSpace(kit.PurchaseUrl) ? settings.StoreUrl : kit.PurchaseUrl;
            if (!WebUrl(url)) { p.ChatMessage(settings.PurchaseMessage); return; }
            string popup = Ui + ".Purchase";
            CuiHelper.DestroyUi(p, popup);
            var c = new CuiElementContainer();
            c.Add(new CuiPanel { Image = { Color = "0.015 0.02 0.03 0.96" }, RectTransform = { AnchorMin = "0 0", AnchorMax = "1 1" }, CursorEnabled = true, KeyboardEnabled = true }, Ui, popup);
            string box = popup + ".Box";
            c.Add(new CuiPanel { Image = { Color = "0.07 0.085 0.11 1" }, RectTransform = { AnchorMin = "0.5 0.5", AnchorMax = "0.5 0.5", OffsetMin = "-360 -140", OffsetMax = "360 140" } }, popup, box);
            CardText(c, box, "ADQUIRIR " + kit.Name, "0.06 0.74", "0.94 0.93", 23);
            CardText(c, box, "Copie o link abaixo e abra no seu navegador.", "0.06 0.6", "0.94 0.74", 15, "0.65 0.72 0.8 1");
            string field = popup + ".Link";
            c.Add(new CuiPanel { Image = { Color = "0.025 0.035 0.05 1" }, RectTransform = { AnchorMin = "0.06 0.37", AnchorMax = "0.94 0.56" } }, box, field);
            c.Add(new CuiElement { Parent = field, Components = {
                new CuiInputFieldComponent { Text = url, FontSize = 16, Align = TextAnchor.MiddleLeft, Color = "0.9 0.75 0.35 1", ReadOnly = true, NeedsKeyboard = true, CharsLimit = 2048 },
                new CuiRectTransformComponent { AnchorMin = "0.02 0", AnchorMax = "0.98 1" }
            }});
            CardText(c, box, "Clique no campo, selecione com Ctrl+A e copie com Ctrl+C.", "0.06 0.23", "0.94 0.35", 13, "0.58 0.65 0.73 1");
            CardButton(c, box, "VOLTAR AOS KITS", "vipkits.buyclose", "0.55 0.06", "0.94 0.21", "0.45 0.33 0.1 1");
            CuiHelper.AddUi(p, c);
        }
        [ConsoleCommand("vipkits.buyclose")]
        private void ClosePurchase(ConsoleSystem.Arg arg)
        {
            var p = arg.Player(); if (p != null) CuiHelper.DestroyUi(p, Ui + ".Purchase");
        }
        [ConsoleCommand("vipkits.claim")]
        private void Claim(ConsoleSystem.Arg arg)
        {
            var p = arg.Player();
            if (p == null || arg.Args == null || arg.Args.Length != 2) return;
            var k = settings.Kits.FirstOrDefault(x => x.Id == arg.Args[0].ToString()); int page;
            if (!int.TryParse(arg.Args[1].ToString(), out page) || k == null) return;
            ClaimKit(p,k,page);
        }
        private void ClaimKit(BasePlayer p, Kit k, int page) {
            if (!Allowed(p,k)) { p.ChatMessage("Voce nao tem permissao para este kit."); return; }
            if (!claimsLoaded) { p.ChatMessage("Dados de cooldown indisponiveis. Avise o owner do servidor."); return; }
            if (!p.IsAlive() || p.IsSleeping()) { p.ChatMessage("Voce precisa estar vivo e acordado."); return; }
            if (!busy.Add(p.userID)) return;
            var created = new List<Item>(); bool delivered = false;
            try
            {
                if (WipeRemaining(k) > 0) { p.ChatMessage("Kit bloqueado apos o wipe. Libera em " + WaitText(WipeRemaining(k)) + "."); return; }
                if (Remaining(p, k) > 0) { p.ChatMessage("Aguarde " + WaitText(Remaining(p, k)) + " para resgatar."); return; }
                Dictionary<string,int> used; int count = 0;
                if (uses.TryGetValue(p.UserIDString, out used)) used.TryGetValue(k.Id, out count);
                if (k.MaximumUses > 0 && count >= k.MaximumUses) { p.ChatMessage("Limite de resgates deste kit atingido."); return; }
                var targets = new List<global::ItemContainer>();
                var positions = new List<int>();
                foreach (var r in k.Items)
                {
                    var def = ItemManager.FindItemDefinition(r.Shortname);
                    if (def == null || r.Amount <= 0) { p.ChatMessage("Item invalido no kit. Avise a administracao."); return; }
                    var target = r.Inventory == "belt" ? p.inventory.containerBelt : r.Inventory == "wear" ? p.inventory.containerWear : p.inventory.containerMain;
                    if (r.Serialized != null) {
                        var item = CreateItem(r.Serialized, p);
                        if (item == null) { p.ChatMessage("Falha ao criar o kit."); return; }
                        created.Add(item); targets.Add(target); positions.Add(r.Serialized.Position);
                    } else {
                        int left = r.Amount, stack = Math.Max(1, def.stackable);
                        while (left > 0) {
                            int amount = Math.Min(left, stack);
                            var item = ItemManager.CreateByName(r.Shortname, amount, r.Skin);
                            if (item == null) { p.ChatMessage("Falha ao criar o kit."); return; }
                            created.Add(item); targets.Add(target); positions.Add(-1); left -= amount;
                        }
                    }
                }
                bool configuredSpace = targets.Distinct().All(target => target.capacity - target.itemList.Count >= targets.Count(x => x == target));
                bool fallbackSpace = p.inventory.containerMain.capacity - p.inventory.containerMain.itemList.Count + p.inventory.containerBelt.capacity - p.inventory.containerBelt.itemList.Count >= created.Count;
                if (!configuredSpace && !fallbackSpace) { p.ChatMessage("Libere espaco na mochila, cintura e roupas para receber o kit."); return; }
                for (int i = 0; i < created.Count; i++) {
                    if (!created[i].MoveToContainer(targets[i], positions[i], false) && !created[i].MoveToContainer(targets[i], -1, false) && !created[i].MoveToContainer(p.inventory.containerMain, -1, false) && !created[i].MoveToContainer(p.inventory.containerBelt, -1, false)) { p.ChatMessage("Nao foi possivel entregar o kit. Libere espaco e tente novamente."); return; }
                }
                if (used == null) uses[p.UserIDString] = used = new Dictionary<string,int>();
                used[k.Id] = count + 1;
                Dictionary<string, double> user;
                if (!claims.TryGetValue(p.UserIDString, out user) || user == null) claims[p.UserIDString] = user = new Dictionary<string, double>();
                user[k.Id] = Now() + k.CooldownSeconds;
                delivered = true; SaveData();
                p.ChatMessage("Kit " + k.Name + " resgatado!");
            }
            finally
            {
                if (!delivered) foreach (var item in created) item.Remove();
                busy.Remove(p.userID); Show(p, page);
            }
        }
        // Legacy Kits serialization retained for lossless migration of configured items.
        #region Serialized Items
        private static Item CreateItem(ItemData itemData, BasePlayer player = null)
        {
            int itemId = itemData.ItemID;
            ulong skin = itemData.Skin;


            if (player != null) { itemId = redirectItem(player,itemId); skin = canUseSkin(player,skin) ? skin : 0UL; }
            Item item = ItemManager.CreateByItemID(itemId, itemData.Amount, skin);
            if (item == null) throw new Exception("Item invalido no kit importado: " + itemData.Shortname);

            if (!string.IsNullOrEmpty(itemData.DisplayName))
                item.name = itemData.DisplayName;

            if (!string.IsNullOrEmpty(itemData.Text))
                item.text = itemData.Text;

            item._condition = itemData.Condition;
            item._maxCondition = itemData.MaxCondition;

            if (itemData.Frequency > 0)
            {
                ItemModRFListener rfListener = item.info.GetComponentInChildren<ItemModRFListener>();
                if (rfListener)
                    (BaseNetworkable.serverEntities.Find(item.instanceData.subEntity) as PagerEntity)?.ChangeFrequency(itemData.Frequency);
            }

            if (itemData.BlueprintItemID != 0)
            {
                if (item.instanceData == null)
                    item.instanceData = new ProtoBuf.Item.InstanceData();

                item.instanceData.ShouldPool = false;

                item.instanceData.blueprintAmount = 1;
                item.instanceData.blueprintTarget = itemData.BlueprintItemID;

                item.MarkDirty();
            }

            FlameThrower flameThrower = item.GetHeldEntity() as FlameThrower;
            if (flameThrower)
                flameThrower.ammo = itemData.Ammo;

            if (itemData.Contents != null)
            {
                foreach (ItemData contentData in itemData.Contents)
                {
                    Item newContent = CreateItem(contentData, player);
                    if (newContent != null)
                    {
                        if (!newContent.MoveToContainer(item.contents))
                            newContent.Remove();
                    }
                }
            }

            if (itemData.Container != null)
            {
                if (item.contents == null)
                {
                    ItemModContainerArmorSlot armorSlot = FindItemMod<ItemModContainerArmorSlot>(item);
                    if (armorSlot)
                        armorSlot.CreateAtCapacity(itemData.Container.slots, item);
                    else
                    {
                        item.contents = Pool.Get<ItemContainer>();
                        item.contents.ServerInitialize(item, itemData.Container.slots);
                        item.contents.GiveUID();
                    }
                }
                itemData.Container.Load(item.contents);
            }

            BaseProjectile weapon = item.GetHeldEntity() as BaseProjectile;
            if (weapon)
            {
                weapon.DelayedModsChanged();

                if (!string.IsNullOrEmpty(itemData.Ammotype))
                    weapon.primaryMagazine.ammoType = ItemManager.FindItemDefinition(itemData.Ammotype);
                weapon.primaryMagazine.contents = itemData.Ammo;
            }


            item.MarkDirty();

            return item;
        }

        private static T FindItemMod<T>(Item item) where T : ItemMod
        {
            foreach (ItemMod itemMod in item.info.itemMods)
            {
                if (itemMod is T mod)
                    return mod;
            }

            return null;
        }

        public class ItemData
        {
            public string Shortname { get; set; }

            public string DisplayName { get; set; }

            public ulong Skin { get; set; }

            public int Amount { get; set; }

            public float Condition { get; set; }

            public float MaxCondition { get; set; }

            public int Ammo { get; set; }

            public string Ammotype { get; set; }

            public int Position { get; set; }

            public int Frequency { get; set; }

            public string BlueprintShortname { get; set; }

            public string Text { get; set; }

            /// <summary>
            /// Deprecated, replaced by serializing the item container instead of just the items in it
            /// </summary>
            public ItemData[] Contents { get; set; }

            public ItemContainer Container { get; set; }


            [JsonIgnore]
            private int _itemId;

            [JsonIgnore]
            private int _blueprintItemId;

            [JsonIgnore]
            private JObject _jObject;


            [JsonIgnore]
            internal int ItemID
            {
                get
                {
                    if (_itemId == 0)
                        _itemId = ItemManager.itemDictionaryByName[Shortname].itemid;
                    return _itemId;
                }
            }

            [JsonIgnore]
            internal bool IsBlueprint => Shortname.Equals(BLUEPRINT_BASE);

            [JsonIgnore]
            internal int BlueprintItemID
            {
                get
                {
                    if (_blueprintItemId == 0 && !string.IsNullOrEmpty(BlueprintShortname))
                        _blueprintItemId = ItemManager.itemDictionaryByName[BlueprintShortname].itemid;
                    return _blueprintItemId;
                }
            }

            [JsonIgnore]
            internal JObject ToJObject
            {
                get
                {
                    if (_jObject == null)
                    {
                        _jObject = new JObject
                        {
                            ["Shortname"] = Shortname,
                            ["DisplayName"] = DisplayName,
                            ["SkinID"] = Skin,
                            ["Amount"] = Amount,
                            ["Condition"] = Condition,
                            ["MaxCondition"] = MaxCondition,
                            ["IsBlueprint"] = BlueprintItemID != 0,
                            ["Ammo"] = Ammo,
                            ["AmmoType"] = Ammotype,
                            ["Text"] = Text,
                            ["Contents"] = new JArray()
                        };

                        for (int i = 0; i < Contents?.Length; i++)
                            (_jObject["Contents"] as JArray).Add(Contents[i].ToJObject);

                        if (Container != null && Container.contents.Count > 0)
                        {
                            for (int i = 0; i < Container.contents.Count; i++)
                                (_jObject["Contents"] as JArray).Add(Container.contents[i].ToJObject);
                        }
                    }

                    return _jObject;
                }
            }

            internal ItemData()
            {
            }

            internal ItemData(Item item)
            {
                Shortname = item.info.shortname;
                Amount = item.amount;
                DisplayName = item.name;
                Text = item.text;

                BaseEntity heldEntity = item.GetHeldEntity();
                if (heldEntity)
                {
                    Ammotype = heldEntity is BaseProjectile projectile ? projectile.primaryMagazine.ammoType.shortname : null;
                    Ammo = heldEntity is BaseProjectile baseProjectile ? baseProjectile.primaryMagazine.contents :
                        heldEntity is FlameThrower thrower ? thrower.ammo : 0;
                }

                Position = item.position;
                Skin = item.skin;

                Condition = item.condition;
                MaxCondition = item.maxCondition;

                Frequency = ItemModAssociatedEntity<PagerEntity>.GetAssociatedEntity(item)?.GetFrequency() ?? -1;

                if (item.instanceData != null && item.instanceData.blueprintTarget != 0)
                    BlueprintShortname = ItemManager.FindItemDefinition(item.instanceData.blueprintTarget).shortname;

                // Deprecated
                //Contents = item.contents?.itemList.Select(item1 => new ItemData(item1)).ToArray();

                if (item.contents != null)
                    Container = new ItemContainer(item.contents);
            }

            public class InstanceData
            {
                public int DataInt { get; set; }

                public int BlueprintTarget { get; set; }

                public int BlueprintAmount { get; set; }

                public uint SubEntityNetID { get; set; }

                internal InstanceData()
                {
                }

                internal InstanceData(Item item)
                {
                    if (item.instanceData == null)
                        return;

                    DataInt = item.instanceData.dataInt;
                    BlueprintAmount = item.instanceData.blueprintAmount;
                    BlueprintTarget = item.instanceData.blueprintTarget;
                }

                internal void Restore(Item item)
                {
                    if (item.instanceData == null)
                        item.instanceData = new ProtoBuf.Item.InstanceData();

                    item.instanceData.ShouldPool = false;

                    item.instanceData.blueprintAmount = BlueprintAmount;
                    item.instanceData.blueprintTarget = BlueprintTarget;
                    item.instanceData.dataInt = DataInt;

                    item.MarkDirty();
                }

                internal bool IsValid => DataInt != 0 || BlueprintAmount != 0 || BlueprintTarget != 0;
            }

            public class ItemContainer
            {
                public int slots;
                public float temperature;
                public int flags;
                public int allowedContents;
                public int maxStackSize;
                public List<int> allowedItems;
                public List<int> availableSlots;
                public int volume;
                public List<ItemData> contents;

                public ItemContainer(){}

                public ItemContainer(global::ItemContainer container)
                {
                    contents = new List<ItemData>();
                    slots = container.capacity;
                    temperature = container.temperature;
                    allowedContents = (int)container.allowedContents;

                    if (container.HasLimitedAllowedItems)
                    {
                        allowedItems = new List<int>();
                        for (int i = 0; i < container.onlyAllowedItems.Length; i++)
                        {
                            if (container.onlyAllowedItems[i])
                            {
                                allowedItems.Add(container.onlyAllowedItems[i].itemid);
                            }
                        }
                    }

                    flags = (int)container.flags;
                    maxStackSize = container.maxStackSize;
                    volume = container.containerVolume;

                    if (container.availableSlots is { Count: > 0 })
                    {
                        availableSlots = new List<int>();
                        for (int j = 0; j < container.availableSlots.Count; j++)
                        {
                            availableSlots.Add((int)container.availableSlots[j]);
                        }
                    }

                    for (int k = 0; k < container.itemList.Count; k++)
                    {
                        Item item = container.itemList[k];
                        if (item.IsValid())
                        {
                            contents.Add(new ItemData(item));
                        }
                    }
                }

                public void Load(global::ItemContainer itemContainer)
                {
                    itemContainer.capacity = slots;
                    itemContainer.itemList = Pool.Get<List<Item>>();
                    itemContainer.temperature = temperature;
                    itemContainer.flags = (global::ItemContainer.Flag)flags;
                    itemContainer.allowedContents = (global::ItemContainer.ContentsType)((allowedContents == 0) ? 1 : allowedContents);

                    if (allowedItems is { Count: > 0 })
                    {
                        itemContainer.onlyAllowedItems = new ItemDefinition[allowedItems.Count];
                        for (int i = 0; i < allowedItems.Count; i++)
                        {
                            itemContainer.onlyAllowedItems[i] = ItemManager.FindItemDefinition(allowedItems[i]);
                        }
                    }
                    else
                    {
                        itemContainer.onlyAllowedItems = null;
                    }

                    itemContainer.maxStackSize = maxStackSize;
                    itemContainer.containerVolume = volume;
                    itemContainer.availableSlots.Clear();

                    if (availableSlots != null)
                    {
                        for (int j = 0; j < availableSlots.Count; j++)
                        {
                            itemContainer.availableSlots.Add((ItemSlot)availableSlots[j]);
                        }
                    }

                    foreach (ItemData itemData in contents)
                    {
                        Item item = CreateItem(itemData);
                        if (item == null)
                            continue;

                        if (!item.MoveToContainer(itemContainer, itemData.Position) && !item.MoveToContainer(itemContainer))
                            item.Remove();
                    }

                    itemContainer.MarkDirty();
                }
            }
        }

        #endregion

    }
}









