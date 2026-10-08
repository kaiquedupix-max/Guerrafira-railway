import importlib.util, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('migration',Path(__file__).with_name('migrate-legacy-kits.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class MigrationTests(unittest.TestCase):
 def test_inventory_payload_permissions_limits_and_exact_claim_times(self):
  payload={'Shortname':'rifle.ak','Amount':1,'Skin':123,'Position':4,'Condition':75.5,'MaxCondition':100,'Ammo':17,'Ammotype':'ammo.rifle','Container':{'slots':3,'contents':[{'Shortname':'weapon.mod.holosight','Amount':1,'Skin':0,'Position':0}]}}
  kit={'Name':'GR3','RequiredPermission':'kits.gr3','MaximumUses':999,'RequiredAuth':0,'Cooldown':28800,'IsHidden':False,'MainItems':[],'BeltItems':[payload],'WearItems':[],'Cost':0}
  config,claims=m.convert({'_kits':{'GR3':kit}},{'_players':{'sample-player':{'_usageData':{'GR3':{'TotalUses':42,'NextUseTime':1791265725.7654738}}}}},{'Post wipe cooldowns (kit name | seconds)':{'GR3':1200}})
  k=config['Kits'][0];self.assertEqual(k['Items'][0]['Serialized'],payload);self.assertEqual(k['Items'][0]['Inventory'],'belt')
  self.assertEqual((k['Permission'],k['MaximumUses'],k['CooldownSeconds'],k['WipeDelaySeconds']),('kits.gr3',999,28800,1200))
  self.assertEqual(k['StoreTier'],'ouro');self.assertEqual(claims['Uses']['sample-player']['gr3'],42)
  self.assertEqual(claims['Cooldowns']['sample-player']['gr3'],1791265725.7654738)
 def test_refuses_unsupported_costs_and_ambiguous_names(self):
  with self.assertRaises(ValueError):m.convert({'_kits':{'x':{'Cost':1}}},{'_players':{}},{})
  with self.assertRaises(ValueError):m.convert({'_kits':{'A B':{},'A_B':{}}},{'_players':{}},{})
if __name__=='__main__':unittest.main()
