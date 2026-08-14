using System;
using System.Linq;
using Newtonsoft.Json;

namespace Oxide.Plugins
{
    [Info("GuerraFriaItemCatalog", "Guerra Fria", "1.0.0")]
    [Description("Expõe o catálogo atual de itens do Rust para o painel administrativo.")]
    public class GuerraFriaItemCatalog : RustPlugin
    {
        [ConsoleCommand("gf.items")]
        private void Items(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && arg.Connection.authLevel < 2) return;

            var items = ItemManager.itemList
                .Where(x => x != null)
                .Select(x => new
                {
                    id = x.itemid,
                    shortname = x.shortname,
                    name = x.displayName?.english ?? x.shortname,
                    category = x.category.ToString(),
                    stack = x.stackable
                })
                .OrderBy(x => x.name)
                .ToList();

            arg.ReplyWith(JsonConvert.SerializeObject(items));
        }
    }
}
