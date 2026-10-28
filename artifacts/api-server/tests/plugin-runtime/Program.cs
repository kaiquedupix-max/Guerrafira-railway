using System;
using System.Text;
using System.Reflection;
using Newtonsoft.Json;
using Oxide.Plugins;
class TestChatPlayer:Oxide.Core.Libraries.Covalence.IPlayer {public string Id {get;set;}}
class Program {
 static int checks;
 static void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS "+label);checks++;}
 static object Call(object target,string method,params object[] args){return target.GetType().GetMethod(method,BindingFlags.Instance|BindingFlags.NonPublic).Invoke(target,args);}
 static GuerraFriaModeration Fresh(){var p=new GuerraFriaModeration();Call(p,"Init");return p;}
 static ConsoleSystem.Arg Command(object p,string method,string value,Network.Connection connection=null){var arg=new ConsoleSystem.Arg{Args=new[]{value},Connection=connection};Call(p,method,arg);return arg;}
 static string Payload(string steam,string ip,long expiry=0){return Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(new {SteamId=steam,Reason="Teste",ExpiresAt=expiry,Ips=new[]{ip}})));}
 static Network.Connection Connect(ulong steam,string address){return new Network.Connection{userid=steam,ipaddress=address};}
 static void Main(){
  const string root="76561190000000001",otherRoot="76561190000000003";const ulong alt=76561190000000002;
  var plugin=Fresh();
  Check(Command(plugin,"Ban",Payload(root,"203.0.113.4:28015")).Reply=="GF_GUARD_BANNED 1","accept valid IP and strip port");
  Check(Call(plugin,"CanClientLogin",Connect(alt,"203.0.113.4:60000")) is string,"different Steam on same IP is rejected");
  Check(Call(plugin,"CanClientLogin",Connect(alt,"203.0.113.5:60000"))==null,"different IP remains allowed");
  Check(Call(plugin,"CanClientLogin",Connect(alt,"[::ffff:203.0.113.4]:60000")) is string,"IPv4 mapped IPv6 cannot bypass ban");
  plugin=Fresh();Check(Call(plugin,"CanClientLogin",Connect(alt,"203.0.113.4")) is string,"IP ban survives plugin reload");
  Command(plugin,"Ban",Payload(otherRoot,"203.0.113.4"));Command(plugin,"Unban",root);
  Check(Call(plugin,"CanClientLogin",Connect(alt,"203.0.113.4")) is string,"removing one root preserves another active ban sharing IP");
  Command(plugin,"Unban",otherRoot);Check(Call(plugin,"CanClientLogin",Connect(alt,"203.0.113.4"))==null,"unban releases IP after all roots are removed");
  Command(plugin,"Ban",Payload(root,"203.0.113.4",DateTimeOffset.UtcNow.ToUnixTimeSeconds()-1));
  Check(Call(plugin,"CanClientLogin",Connect(alt,"203.0.113.4"))==null,"already expired bans do not block reconnects");
  var denied=Command(plugin,"Ban",Payload(root,"203.0.113.4"),Connect(alt,"203.0.113.9"));
  Check(denied.Reply=="GF_GUARD_DENIED","unprivileged console callers cannot create IP bans");
  Check(Command(plugin,"Ban","not-base64").Reply=="GF_GUARD_INVALID_PAYLOAD","malformed command fails without changing rules");
  Command(plugin,"Ban",Payload(root,"[2001:db8::1]:28015"));
  Check(Call(plugin,"CanClientLogin",Connect(alt,"[2001:db8::1]:40000")) is string,"IPv6 reconnection is blocked");
  Command(plugin,"Unban",root);
  Call(plugin,"CanClientLogin",Connect(ulong.Parse(root),"203.0.113.99:1234"));
  var info=Command(plugin,"PlayerInfo",root).Reply;
  Check(info.Contains("203.0.113.99"),"offline identity retains latest observed address");
  var team=new RelationshipManager.Team();team.members.Add(ulong.Parse(root));team.members.Add(alt);RelationshipManager.ServerInstance.Teams[ulong.Parse(root)]=team;
  var members=JsonConvert.DeserializeObject<object[]>(Command(plugin,"TeamInfo",root).Reply);
  Check(members.Length==2,"team lookup returns actual complete team including offline members");
  var player=new BasePlayer{userID=ulong.Parse(root)};BasePlayer.activePlayerList.Add(player);
  var mute=new ConsoleSystem.Arg{Args=new[]{root,(DateTimeOffset.UtcNow.ToUnixTimeSeconds()+120).ToString()}};
  Call(plugin,"MuteChat",mute);
  Check(mute.Reply=="GF_GUARD_MUTED "+root && player.ChatMuted,"mute returns explicit confirmation and sets native flag");
  Check(Call(plugin,"OnPlayerChat",player,"hello",ConVar.Chat.ChatChannel.Global)!=null,"muted player cannot send global chat");
  Check(Call(plugin,"OnPlayerChat",player,"hello",ConVar.Chat.ChatChannel.Team)!=null,"muted player cannot bypass via team chat");
  var betterChat=new System.Collections.Generic.Dictionary<string,object>{{"Player",new TestChatPlayer{Id=root}},{"CancelOption",0}};Call(plugin,"OnBetterChat",betterChat);
  Check((int)betterChat["CancelOption"]==2,"BetterChat cannot bypass the mute");
  plugin=Fresh();Call(plugin,"OnServerInitialized");
  Check(player.ChatMuted,"mute survives plugin reload");
  var unmute=Command(plugin,"UnmuteChat",root);
  Check(unmute.Reply=="GF_GUARD_UNMUTED "+root && !player.ChatMuted,"unmute clears native mute flag");
  Check(Call(plugin,"OnPlayerChat",player,"hello",ConVar.Chat.ChatChannel.Global)==null,"unmuted player can chat again");
  var invalid=new ConsoleSystem.Arg{Args=new[]{root,(DateTimeOffset.UtcNow.ToUnixTimeSeconds()-1).ToString()}};
  Call(plugin,"MuteChat",invalid);Check(invalid.Reply=="GF_GUARD_INVALID_PAYLOAD","expired mute is rejected");
  Call(plugin,"MuteChat",mute);
  var saved=Newtonsoft.Json.Linq.JObject.Parse(Oxide.Core.Interface.Oxide.DataFileSystem.Json);
  saved["Mutes"][root]=DateTimeOffset.UtcNow.ToUnixTimeSeconds()-1;Oxide.Core.Interface.Oxide.DataFileSystem.Json=saved.ToString();
  plugin=Fresh();Call(plugin,"Prune");Check(!player.ChatMuted,"expired mute releases player without bot worker");
  Console.WriteLine(checks+" plugin runtime checks passed (Rust API adapters)");
 }
}
