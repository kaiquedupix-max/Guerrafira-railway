using System.Collections.Generic;
using Oxide.Core.Plugins;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("InvadersBlacklist", "Guerra Fria", "1.0.0")]
    [Description("Base Invaders: remove itens e bloqueia construções proibidas pelo regulamento")]
    public class InvadersBlacklist : RustPlugin
    {
        private const string Prefix = "<color=#ffcc00>[Base Invaders]</color> ";

        // Itens proibidos no evento, pelo regulamento do Base Invaders.
        // shortcut: os shortnames foram escritos de memória; confirme cada um no log de "item not found" no primeiro teste.
        private static readonly HashSet<string> BlacklistedItems = new HashSet<string>
        {
            // Armas e atachamentos
            "weapon.mod.silencer", "weapon.mod.8x.scope", "hmlmg", "m16", "shotgun.double", "trap.bar.shotgun",
            // Explosivos e arremessáveis
            "explosive.satchel", "grenade.f1", "grenade.molotov", "grenade.flashbang", "grenade.smoke",
            // Munições incendiárias
            "ammo.rifle.incendiary", "ammo.pistol.fire", "rocket.fire",
            // Armadura
            "heavy.plate.helmet", "heavy.plate.jacket", "heavy.plate.pants",
        };

        // Itens de construção proibidos. Remove a entidade assim que ela é colocada por um jogador.
        private static readonly HashSet<string> BlacklistedDeployables = new HashSet<string>
        {
            "snap_trap", "landmine", "spikes.floor", "watchtower.wood", "computerstation.deployed",
            "solarpanel.large", "windmill.deployed", "battery.small.deployed", "battery.medium.deployed", "battery.large.deployed",
        };

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
