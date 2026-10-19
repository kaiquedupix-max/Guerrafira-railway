#!/usr/bin/env python3
"""Produce server-specific source packages without copying production secrets."""
from pathlib import Path
import argparse,zipfile,hashlib,json
parser=argparse.ArgumentParser();parser.add_argument('--output',required=True,type=Path);args=parser.parse_args()
root=Path(__file__).resolve().parents[1];out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
season=(root/'rust-plugins/GuerraFriaSeasonV117.cs').read_text();leaderboard=(root/'rust-plugins/GuerraFriaLeaderboard.cs').read_text()
for label,server in [('Duo','solo-duo'),('Trio','trio')]:
 directory=out/label;directory.mkdir(exist_ok=True)
 target=season.replace('public string ServerId = "solo-duo";',f'public string ServerId = "{server}";')
 marker='if (SeasonApi == null) SeasonApi = new SeasonApiConfig();'
 assert target.count(marker)==1
 target=target.replace(marker,marker+f'\n                SeasonApi.ServerId = "{server}"; // Package target; preserve all other configuration.')
 event_marker='public string event_id;';assert leaderboard.count(event_marker)==1
 board=leaderboard.replace(event_marker,event_marker+f'\n            public string server_id = "{server}";')
 (directory/'GuerraFriaSeasonV117.cs').write_text(f'// Pacote exclusivo: {label}\n'+target)
 (directory/'GuerraFriaLeaderboard.cs').write_text(f'// Pacote exclusivo: {label}\n'+board)
 readme=f'''GUERRA FRIA - PLUGINS {label.upper()}

Arquivos: GuerraFriaSeasonV117.cs e GuerraFriaLeaderboard.cs (1.6.0).
Instale este pacote SOMENTE no servidor {label}. Mantenha os nomes dos arquivos.

1. Faca o deploy da main no Coolify ANTES de atualizar os plugins.
2. Faca backup dos dois .cs e da configuracao/dados existentes.
3. Substitua os dois .cs na pasta de plugins do Carbon desse servidor.
4. Recarregue com: c.reload GuerraFriaSeasonV117
   e: c.reload GuerraFriaLeaderboard
5. Preserve a configuracao e a Secret da Season. Este pacote identifica
   automaticamente o servidor como {server}, sem substituir a Secret.
   Se usar TRIO_SEASON_WEBHOOK_SECRET, o Trio deve usar esse mesmo valor.
6. Confira no console: gflb.status e ausencia de erros de compilacao/API.

O novo leaderboard identifica a criacao do save e informa um mapa novo ao bot.
Reiniciar/recarregar no mesmo mapa NAO e wipe. O primeiro contato registra o
mapa atual sem apagar estatisticas; o proximo mapa limpa o ranking desse servidor.
O reset limpa estatisticas, jogadores do wipe e lideres, preservando a Season.
A aplicacao bloqueia eventos anteriores ao reset para nao repor dados antigos.
O bot precisa estar conectado ao RCON correto; o heartbeat recupera o aviso em
ate um minuto apos reconectar. O ranking do Trio inicia a partir do proximo wipe.

Se as estatisticas antigas precisarem ser removidas agora, use o reset do
leaderboard no painel selecionando o servidor correto, apos fazer o deploy.
Nao apague os dados da Season para resetar o leaderboard do wipe.

Validacao: este pacote contem codigo-fonte. A instalacao e validacao no Rust/
Carbon real dependem do acesso ao servidor; nao sao feitas pelo download.
'''
 (directory/'LEIA-ME.txt').write_text(readme)
 files=list(directory.glob('*.cs'));manifest={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in files};(directory/'SHA256.json').write_text(json.dumps(manifest,indent=2)+'\n')
 archive=out/f'GuerraFria-{label}-Season-Leaderboard.zip'
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
  for p in sorted(directory.iterdir()):z.write(p,p.name)
 print(archive)
