"""Loopback-only allowlisted avatar resource fixture; never a game/TTS backend.

Model bytes remain in the host checkout and are never copied into plugin source
or release assets. Only the model's exact public FileReferences and eight
required runtime scripts can be served.
"""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
from urllib.parse import unquote, urlsplit, quote

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
HOST_ROOT = PLUGIN_ROOT.parents[2]
MODEL = HOST_ROOT / 'static/mao_pro/mao_pro.model3.json'
ENGINE = json.loads((PLUGIN_ROOT / 'protocol/avatar-engine.json').read_text())
SCRIPTS = {
    'neko-minigame-avatar-host.js': ENGINE['avatarHostScript'].lstrip('/'),
    **{'engine/' + path.rsplit('/', 1)[-1]: path.lstrip('/') for path in ENGINE['engineScripts']},
}

def resources():
    model = json.loads(MODEL.read_text())
    references = model['FileReferences']
    refs = [references[key] for key in ['Moc','Physics','Pose','DisplayInfo'] if references.get(key)]
    refs += references.get('Textures',[])
    refs += [item['File'] for item in references.get('Expressions',[]) if item.get('File')]
    for group in references.get('Motions',{}).values():
        for item in group:
            refs += [item[key] for key in ['File','Sound'] if item.get(key)]
    allowlist = {f'/runtime/{key}': HOST_ROOT / path for key,path in SCRIPTS.items()}
    allowlist['/model/mao_pro.model3.json'] = MODEL
    for ref in sorted(set(refs)):
        file = (MODEL.parent / ref).resolve()
        if not file.is_relative_to(MODEL.parent.resolve()): raise ValueError(f'Invalid model reference: {ref}')
        allowlist[f'/model/{ref}'] = file
    missing = [str(file) for file in allowlist.values() if not file.is_file()]
    if missing: raise FileNotFoundError(f'Incomplete fixture resources: {missing}')
    return allowlist, len(set(refs))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--origin',action='append',required=True)
    parser.add_argument('--ready-file',required=True)
    parser.add_argument('--log-file',required=True)
    args=parser.parse_args()
    ready=Path(args.ready_file).resolve();log=Path(args.log_file).resolve()
    for output in [ready,log]:
        if not output.is_relative_to(PLUGIN_ROOT/'test-results'):raise ValueError('Fixture files must stay in plugin test-results/')
        output.parent.mkdir(parents=True,exist_ok=True)
    origins=set(args.origin)
    if any(urlsplit(origin).scheme!='http' or urlsplit(origin).hostname not in {'127.0.0.1','localhost'} for origin in origins):
        raise ValueError('Only explicit loopback development origins are allowed')
    files,ref_count=resources()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,fmt,*values):
            # pytest --basetemp may recreate its tree while this optional fixture
            # is still serving. Logging must never turn a valid asset into 500.
            try:
                log.parent.mkdir(parents=True,exist_ok=True)
                with log.open('a') as stream:stream.write(json.dumps({'request':self.path,'message':fmt%values})+'\n')
            except OSError as error:
                print(f'AVATAR_FIXTURE_LOG_WARNING {error}',flush=True)
        def response(self,data,content_type='application/json; charset=utf-8',status=200):
            self.send_response(status);self.send_header('Content-Type',content_type)
            origin=self.headers.get('Origin')
            if origin in origins:self.send_header('Access-Control-Allow-Origin',origin)
            self.send_header('Vary','Origin');self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(data)));self.end_headers()
            if self.command!='HEAD':self.wfile.write(data)
        def do_OPTIONS(self):
            if self.headers.get('Origin') not in origins:return self.response(b'',status=403)
            self.send_response(204);self.send_header('Access-Control-Allow-Origin',self.headers['Origin'])
            self.send_header('Access-Control-Allow-Methods','GET, HEAD, OPTIONS');self.send_header('Access-Control-Allow-Headers','Content-Type');self.end_headers()
        def do_HEAD(self):self.do_GET()
        def do_GET(self):
            if self.headers.get('Origin') and self.headers['Origin'] not in origins:return self.response(b'forbidden',status=403)
            path=unquote(urlsplit(self.path).path)
            if path=='/health':return self.response(b'{"ok":true,"fixture":"avatar-only-no-host-session"}')
            if path=='/manifest.json':
                manifest={'name':'Official mao_pro verification fixture','generation':'official-fixture',
                          'modelUrl':f'{base}/model/mao_pro.model3.json',
                          'scripts':[f'{base}/runtime/{key}' for key in SCRIPTS]}
                return self.response(json.dumps(manifest,ensure_ascii=False).encode())
            file=files.get(path)
            if file is None:return self.response(b'not found',status=404)
            media=mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
            return self.response(file.read_bytes(),media)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    base=f'http://127.0.0.1:{server.server_port}'
    info={'fixture':'actual-avatar-engine-no-real-character-or-TTS','base':base,'health':base+'/health',
          'manifest':base+'/manifest.json','origin':args.origin,'file_count':len(files),'model_reference_count':ref_count,
          'model_bytes':sum(file.stat().st_size for url,file in files.items() if url.startswith('/model/')),
          'page':args.origin[0]+'/tests/e2e/avatar-fixture.html?fixture='+quote(base,safe=''),
          'log_file':str(log),'allowed_paths':sorted(files)}
    ready.write_text(json.dumps(info,ensure_ascii=False,indent=2)+'\n')
    print('AVATAR_FIXTURE_READY '+json.dumps(info,ensure_ascii=False),flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()

if __name__=='__main__':main()
