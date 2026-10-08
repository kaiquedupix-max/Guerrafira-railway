"""Offline lossless converter. Input/output contain private player history; never commit them.
Usage: python migrate-legacy-kits.py kits_data.json player_data.json Kits.json output-directory
Stop legacy claims and take a final snapshot before installing generated files.
"""
import json, re, sys
from pathlib import Path

def convert(kits_data, player_data, old_config):
    mapping={name:re.sub(r'[^a-z0-9_-]', '_', name.lower()) for name in kits_data['_kits']}
    if len(set(mapping.values())) != len(mapping): raise ValueError('Kit IDs collide')
    tiers={'kits.gr1':'bronze','kits.gr2':'prata','kits.gr3':'ouro'}
    kits=[]
    for name,k in kits_data['_kits'].items():
        if k.get('Cost',0) or k.get('CopyPasteFile'): raise ValueError('Paid or CopyPaste kit requires manual migration: '+name)
        items=[]
        for source,target in [('MainItems','main'),('BeltItems','belt'),('WearItems','wear')]:
            for item in k[source]:
                items.append({'Shortname':item['Shortname'],'Amount':item['Amount'],'Skin':item['Skin'],'Inventory':target,'Serialized':item})
        tier=tiers.get(k['RequiredPermission'],'')
        kits.append({'Id':mapping[name],'Name':k['Name'],'Description':k.get('Description',''),'Permission':k['RequiredPermission'],
          'StoreTier':tier,'MaximumUses':k['MaximumUses'],'RequiredAuth':k['RequiredAuth'],'Hidden':k['IsHidden'],
          'CooldownSeconds':k['Cooldown'],'WipeDelaySeconds':old_config.get('Post wipe cooldowns (kit name | seconds)',{}).get(name,0),
          'ImageUrl':('https://www.guerrafriarust.com.br/api/store/art/vip-'+tier) if tier else k.get('KitImage',''),'Items':items})
    cooldowns={};uses={}
    for player,data in player_data['_players'].items():
        cooldowns[player]={};uses[player]={}
        for name,usage in data['_usageData'].items():
            # Preserve removed-kit history too, without making it claimable.
            key=mapping.get(name,re.sub(r'[^a-z0-9_-]', '_',name.lower()))
            cooldowns[player][key]=usage['NextUseTime'];uses[player][key]=usage['TotalUses']
    config={'Title':'KITS GUERRA FRIA','StoreUrl':'https://www.guerrafriarust.com.br/loja',
      'WipePlayerData':old_config.get('Wipe player data when the server is wiped',False),
      'OwnedSkins':old_config.get('Only show/give players skins that they are allowed to use (requires PlayerDLCAPI)',False),'Kits':kits}
    return config,{'Cooldowns':cooldowns,'Uses':uses}

if __name__=='__main__':
    a,b,c,out=sys.argv[1:];config,claims=convert(*[json.loads(Path(f).read_text(encoding='utf-8-sig')) for f in [a,b,c]])
    root=Path(out);(root/'config').mkdir(parents=True,exist_ok=True);(root/'data').mkdir(exist_ok=True)
    (root/'config'/'VipKits.json').write_text(json.dumps(config,ensure_ascii=False,indent=2),encoding='utf-8')
    (root/'data'/'VipKits.json').write_text(json.dumps(claims,indent=2),encoding='utf-8')
    print(json.dumps({'kits':len(config['Kits']),'items':sum(len(k['Items']) for k in config['Kits']),'players':len(claims['Cooldowns']),'usageEntries':sum(len(u) for u in claims['Uses'].values()),'totalUses':sum(sum(u.values()) for u in claims['Uses'].values())}))
