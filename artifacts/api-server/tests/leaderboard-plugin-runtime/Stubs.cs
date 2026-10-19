using System;
using System.Collections.Generic;
namespace Oxide.Core { public class Stub {} }
namespace UnityEngine {public struct Vector3 {public static float Distance(Vector3 a,Vector3 b)=>1f;}public class Transform {public Vector3 position;}}
namespace Oxide.Plugins {
 [AttributeUsage(AttributeTargets.Class)]public class InfoAttribute:Attribute {public InfoAttribute(string a,string b,string c){}}
 [AttributeUsage(AttributeTargets.Class)]public class DescriptionAttribute:Attribute {public DescriptionAttribute(string a){}}
 [AttributeUsage(AttributeTargets.Method)]public class ConsoleCommandAttribute:Attribute {public ConsoleCommandAttribute(string a){}}
 public class TimerStub {public Action Callback;public void Every(float seconds,Action callback){Callback=callback;}}
 public class RustPlugin {public List<string> Logs=new();public TimerStub timer=new();protected void Puts(string text)=>Logs.Add(text);protected void PrintError(string text)=>throw new Exception(text);protected void NextTick(Action action)=>action();}
}
public static class SaveRestore {public static DateTime SaveCreatedTime=new DateTime(2026,10,18,0,0,0,DateTimeKind.Utc);}
public class BaseEntity {public string ShortPrefabName="rifle.ak";public UnityEngine.Transform transform=new();}
public class BaseCombatEntity:BaseEntity {}
public class BasePlayer:BaseCombatEntity {public ulong userID;public string UserIDString=>userID.ToString();public string displayName="Player";public Item GetActiveItem()=>new Item{info=new ItemDefinition{shortname="rocket.launcher"}};}
public class HitInfo {public BasePlayer InitiatorPlayer;public BaseEntity WeaponPrefab=new();public BaseEntity Weapon=new();public uint HitBone;public bool isHeadshot;}
public static class StringPool {public static string Get(uint value)=>"head";}
public class Item {public int amount=1;public ItemDefinition info=new();}
public class ItemDefinition {public string shortname="wood";}
public class ItemCraftTask {}
public class ItemCrafter {public BasePlayer owner;}
public class ResourceDispenser {}
public class CollectibleEntity {}
public class ThrownWeapon {}
public class ConsoleSystem {public class Arg {public void ReplyWith(string text){}}}
