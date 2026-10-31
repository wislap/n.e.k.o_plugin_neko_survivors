"""Serve only local benchmark roots; never loads user or host configuration."""
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote,urlsplit
import json,mimetypes,os,argparse
parser=argparse.ArgumentParser(description='Isolated read-only 4K benchmark origin')
parser.add_argument('--out',default='test-results/gpu-benchmark-20261029')
parser.add_argument('--controlled-only',action='store_true')
parser.add_argument('--community-dir')
args=parser.parse_args()
front=Path(__file__).resolve().parents[2];out=Path(args.out).resolve()
if not args.controlled_only:
 natural=json.loads((out/'natural-wave50.json').read_text());run=natural['save']['checkpoint'];assert run['waveIndex']==49 and run['phase']=='playing'
 entry={**natural['save'],'run':run,'checkpoint':run}
 legacy={**run,**run['player'],'phase':'play','p1Ai':True,'party':1};legacy.pop('player',None)
 (out/'entry-v2.json').write_text(json.dumps(entry));(out/'entry-v1.json').write_text(json.dumps(legacy))
community=Path(args.community_dir).resolve()if args.community_dir else front/'test-results/profile-build'
if args.community_dir and not community.is_relative_to(front/'test-results'):raise ValueError('community-dir must be a QA build inside frontend/test-results')
roots={'community':(front/'public'if args.controlled_only else community),'original':front.parent.parent/'neko_survivors/static/game','bench':out/'site','tools':out/'tools','results':out}
class H(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  pieces=unquote(urlsplit(self.path).path).strip('/').split('/');status=404;data=b'not found';mime='text/plain'
  if len(pieces)>1 and pieces[0]in roots and all(p not in('.','..')for p in pieces) and '\\'not in self.path:
   root=roots[pieces[0]].resolve();file=(root/'/'.join(pieces[1:])).resolve()
   if file.is_relative_to(root)and file.is_file():
    data=file.read_bytes();status=200;mime=mimetypes.guess_type(file)[0]or'application/octet-stream'
    if not args.controlled_only and pieces[1:] == ['index.html'] and pieces[0]in ['community','original']:
     source={'community':{'neko_survivors_react:run:v2':entry,'neko_survivors_react:meta:v2':natural['meta'],'neko_survivors_react:settings:v1':{'enabled':False,'master':0,'sfx':0,'music':0,'playerEffectOpacity':1}},'original':{'neko_miao_save_v1':legacy,'neko_miao_meta_v1':{'fxAlpha':100}}}[pieces[0]]
     script='<script>'+''.join('localStorage.setItem('+json.dumps(k)+','+json.dumps(json.dumps(v))+');'for k,v in source.items())+'</script>'
     data=data.replace(b'<head>',b'<head>'+script.encode(),1)
  self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.send_header('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; frame-src 'none'; worker-src 'self' blob:");self.end_headers()
  try:self.wfile.write(data)
  except BrokenPipeError:pass
s=ThreadingHTTPServer(('127.0.0.1',0),H);(out/'server.json').write_text(json.dumps({'port':s.server_port,'pid':os.getpid()}));print(s.server_port,flush=True)
try:s.serve_forever()
except KeyboardInterrupt:pass
finally:s.server_close()
