using System.Collections.Generic;
using Oxide.Core.Plugins;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("InvadersBlacklist", "Guerra Fria", "1.0.0")]
    [Description("Guerra Fria Invaders: remove itens e bloqueia construções proibidas pelo regulamento")]
    public class InvadersBlacklist : RustPlugin
    {
        private const string Prefix = "<color=#ffcc00>[Guerra Fria Invaders]</color> ";

        // Itens proibidos no evento, pelo regulamento do Guerra Fria Invaders.
        // Shortnames conferidos no servidor (c.reload InvadersBlacklist não mostra aviso). Deployables ainda não foram conferidos.
        private static readonly HashSet<string> BlacklistedItems = new HashSet<string>
        {
            // Armas e atachamentos
            "weapon.mod.silencer", "weapon.mod.8x.scope", "hmlmg", "m16a2", "shotgun.double", "gamesroom.shotgun.trap",
            // Explosivos e arremessáveis
            "explosive.satchel", "grenade.f1", "grenade.molotov", "grenade.flashbang", "grenade.smoke",
            // Munições incendiárias
            "ammo.rifle.incendiary", "ammo.pistol.fire", "ammo.rocket.fire",
            // Energia: turbina eólica (item confirmado na sonda do servidor). Bateria e painel solar são bloqueados como construção.
            "generator.wind.scrap",
            // Armadura
            "heavy.plate.helmet", "heavy.plate.jacket", "heavy.plate.pants",
        };

        // Itens de construção proibidos. Remove a entidade assim que ela é colocada por um jogador.
        private static readonly HashSet<string> BlacklistedDeployables = new HashSet<string>
        {
            // Nomes conferidos no servidor com a sonda de deployables (item -> prefab da entidade).
            "landmine", "spikes.floor", "spikes.trap", "watchtower.wood", "computerstation.deployed", "electric.windmill.small",
            "solarpanel.large.deployed", "smallrechargablebattery.deployed", "medium.rechargable.battery.deployed", "large.rechargable.battery.deployed",
        };

        // Confere cada shortname ao iniciar: nome que o jogo não reconhece aparece no log para correção.
        private void OnServerInitialized()
        {
            foreach (var shortname in BlacklistedItems)
            {
                if (ItemManager.FindItemDefinition(shortname) == null)
                {
                    PrintWarning($"Shortname de item proibido não encontrado: {shortname}");
                }
            }
        }

        private void OnItemAddedToContainer(ItemContainer container, Item item)
        {
            if (item == null || !BlacklistedItems.Contains(item.info.shortname)) return;

            var owner = container?.playerOwner;
            item.Remove();
            if (owner != null)
            {
                owner.ChatMessage(Prefix + $"<color=#ff6666>{item.info.displayName.english}</color> é proibido no evento e foi removido.");
            }
        }

        private void OnEntityBuilt(Planner planner, GameObject go)
        {
            var entity = go?.ToBaseEntity();
            if (entity == null || !BlacklistedDeployables.Contains(entity.ShortPrefabName)) return;

            var player = planner?.GetOwnerPlayer();
            entity.Kill();
            if (player != null)
            {
                player.ChatMessage(Prefix + $"<color=#ff6666>{entity.ShortPrefabName}</color> é proibido no evento e não foi colocado.");
            }
        }
    }
}
