using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
namespace Oxide.Plugins {
 [AttributeUsage(AttributeTargets.Class)] public class InfoAttribute:Attribute {public InfoAttribute(string a,string b,string c){}}
 [AttributeUsage(AttributeTargets.Class)] public class DescriptionAttribute:Attribute {public DescriptionAttribute(string a){}}
 [AttributeUsage(AttributeTargets.Method)] public class ConsoleCommandAttribute:Attribute {public ConsoleCommandAttribute(string a){}}
 public class Timers {public void Every(float seconds,Action callback){}}
 public class RustPlugin {protected string Name="GuerraFriaModeration";protected Timers timer=new Timers();protected void Puts(string s){}protected void PrintError(string s){Console.Error.WriteLine(s);}}
}
namespace Oxide.Core {public static class Interface {public static Host Oxide=new Host();}public class Host {public Files DataFileSystem=new Files();}public class Files {public string Json;public T ReadObject<T>(string name){return Json==null?default(T):JsonConvert.DeserializeObject<T>(Json);}public void WriteObject(string name,object value){Json=JsonConvert.SerializeObject(value);}}}
namespace Network {public class Connection {public string ipaddress;public ulong userid;public uint authLevel;}}
public class ConsoleSystem {public class Arg {public Network.Connection Connection;public string[] Args;public string Reply;public string GetString(int index,string fallback){return Args!=null&&Args.Length>index?Args[index]:fallback;}public void ReplyWith(string value){Reply=value;}}}
public class BasePlayer {public static List<BasePlayer> activePlayerList=new List<BasePlayer>();public static List<BasePlayer> sleepingPlayerList=new List<BasePlayer>();public ulong userID;public string UserIDString=>userID.ToString();public string displayName;public bool IsConnected=true;public Net net=new Net();public class Net {public Network.Connection connection;}public static BasePlayer FindByID(ulong id){return activePlayerList.FirstOrDefault(p=>p.userID==id);}public static BasePlayer FindSleeping(ulong id){return sleepingPlayerList.FirstOrDefault(p=>p.userID==id);}public void Kick(string reason){IsConnected=false;}}
public class RelationshipManager {public static RelationshipManager ServerInstance=new RelationshipManager();public class Team {public List<ulong> members=new List<ulong>();}public Dictionary<ulong,Team> Teams=new Dictionary<ulong,Team>();public Team FindPlayersTeam(ulong id){return Teams.ContainsKey(id)?Teams[id]:null;}}
