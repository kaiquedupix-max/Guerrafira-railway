using System;
using System.Text;
using System.Reflection;
using Newtonsoft.Json;
using Oxide.Plugins;
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
  Console.WriteLine(checks+" plugin runtime checks passed (Rust API adapters)");
 }
}
