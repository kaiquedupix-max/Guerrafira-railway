using System;
using System.Reflection;
using Newtonsoft.Json.Linq;
using Oxide.Plugins;
var plugin=new GuerraFriaLeaderboard();
void Call(string name,params object[] args)=>typeof(GuerraFriaLeaderboard).GetMethod(name,BindingFlags.NonPublic|BindingFlags.Instance).Invoke(plugin,args);
JObject Last()=>JObject.Parse(plugin.Logs[^1].Substring("[GF_LEADERBOARD] ".Length));
void Check(bool ok,string message){if(!ok)throw new Exception(message);}
Call("OnServerInitialized");var first=Last();Check((string)first["event"]=="ready","Ready event missing");Check((long)first["wipe_started_at"]>0,"Map creation timestamp missing");
plugin.timer.Callback();var second=Last();Check((long)first["wipe_started_at"]==(long)second["wipe_started_at"],"Heartbeat changed wipe identity");Check((string)first["event_id"]!=(string)second["event_id"],"Event ID reused");
SaveRestore.SaveCreatedTime=SaveRestore.SaveCreatedTime.AddDays(3);Call("OnNewSave","new.sav");Check((long)Last()["wipe_started_at"]>(long)first["wipe_started_at"],"New map did not advance wipe identity");
var player=new BasePlayer{userID=76561190000000001};Call("TrackGather",player,new Item{amount=25});var gather=Last();Check((string)gather["event"]=="gather"&&(int)gather["amount"]==25,"Gather protocol broken");Check((long)gather["wipe_started_at"]>(long)first["wipe_started_at"],"Gather still belongs to old wipe");
Console.WriteLine("Leaderboard plugin: ready, heartbeat, unique IDs, new save and gather passed.");
