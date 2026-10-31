"""Read-only old-UI visual reference, with no old Game/main or host integration.

Only the sibling reference static/game tree is served. Logs and ready metadata
stay in the target plugin's ignored frontend/test-results/visual-parity tree.
"""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

PLUGIN = Path(__file__).resolve().parents[3]
REFERENCE = (PLUGIN.parent / 'neko_survivors/static/game').resolve()
OUTPUT = PLUGIN / 'frontend/test-results/visual-parity'
FREEZE_CSS = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'

CANONICAL_SCRIPT = r'''
import { RNG } from './src/core/rng.js';
import { Player } from './src/entities/player.js';
import { Shop } from './src/systems/shop.js';
import { serializeStatMods } from './src/core/stats.js';
import { rollUpgrades } from './src/data/upgrades.js';
import { getWaveDuration } from './src/data/waves.js';
export const scenes = ['title','character','shop','upgrade','pause','results','endless','hud'];
export function normalizeScene(value) { return ({ paused:'pause', result:'results', 'endless-prompt':'endless' })[value] || value; }
export async function buildCanonical(input, variant='rich') {
  const scene = normalizeScene(input), rng = new RNG(69), shop = new Shop(rng);
  if (!scenes.includes(scene)) throw new Error('Unsupported canonical scene: '+scene);
  if (!['rich','poor','sold-locked','sell','reward'].includes(variant)) throw new Error('Unsupported shop variant');
  function preparePlayer(stream) {
    const value=new Player('yui',stream);
    if(scene==='shop') {value.addWeapon('cat_paw');value.addItem('warm_milk');if(variant!=='poor')value.gainMaterials(180);}
    if(scene==='hud')value.gainXp(Math.floor(value.xpNeeded/3));
    return value;
  }
  const player=preparePlayer(rng), warmupPlayer=preparePlayer(new RNG(69)), upgrades=[], rewards=[];
  const waveIndex = scene === 'endless' ? 19 : 0;
  const phase = ({ pause:'playing', hud:'playing', results:'result', endless:'endless-prompt' })[scene] || (scene==='upgrade' || scene==='shop' ? scene : 'playing');
  const encode=(source,phase)=>JSON.parse(JSON.stringify({ seed:69, rngState:rng.state, waveIndex, difficulty:'normal', phase, pilot:false,
    characterId:source.characterId, level:source.level, xp:source.xp, xpNeeded:source.xpNeeded, materials:source.materials, hp:source.hp,
    shield:source.shield, maxShield:source.maxShield, weapons:source.weapons.map(weapon=>({id:weapon.def.id,level:weapon.level})),
    items:[...source.items], upgrades:[...source.upgradesTaken], stats:{...serializeStatMods(source.stats),capBonus:{...source.stats.capBonus}},
    charMul:{...source.charMul}, kills:source.kills, damageDealt:source.damageDealt, damageTaken:source.damageTaken,timeAlive:source.timeAlive,
    pendingLevelUps:source.pendingLevelUps, afterUpgrade:'playing', upgradeOptions:upgrades.map(option=>({id:option.id,rarity:option.rarity})),
    won:phase==='endless-prompt', endless:false, retries:0, manualRetries:0, pendingItemRewards:rewards,
    shop: { offers:shop.offers.map(offer=>({kind:offer.kind,id:offer.id,price:offer.price,sold:offer.sold,meta:offer.meta})),
      locked:[...shop.locked],rerollCount:shop.rerollCount,mateRerolls:[...shop.mateRerolls],freeRerollUsed:shop.freeRerollUsed } }));
  // Capture the actual combat state before any menu-only purchase or levelup.
  // Its independent real Player remains unchanged for the reference DOM chrome.
  const warmupSave=encode(warmupPlayer,'playing');
  if (scene === 'shop') {
    shop.difficultyId = 'normal'; shop.roll(player, 0);
    if (variant === 'sold-locked') { const bought=shop.buy(player,0); if (!bought.ok) throw new Error('Canonical purchase rejected'); shop.toggleLock(1); }
    if (variant === 'reward') {
      const { World } = await import('./src/systems/world.js');
      const reward = World.prototype._rollRewardItem.call({rng},player,true);
      if (!reward) throw new Error('Actual reward roll returned no content'); rewards.push(reward);
    }
  }
  if (scene === 'upgrade') {
    player.gainXp(player.xpNeeded);
    upgrades.push(...rollUpgrades(rng, player.upgradesTaken, 3, { level:player.level, luck:player.stats.values.luck, luckEffectMul:player.stats.luckEffectMul }));
  }
  const save=encode(player,phase);
  const expected={canRetry:scene==='results',player:{characterId:player.characterId,hp:player.hp,maxHp:player.stats.get('maxHp'),level:player.level,xp:player.xp,
      materials:player.materials,stats:{...player.stats.values},weapons:player.weapons.map(w=>({id:w.def.id,level:w.level}))},
    offers:shop.offers.map((offer,index)=>({kind:offer.kind,id:offer.id,price:offer.price,sold:offer.sold,locked:shop.locked.has(index)})),
    upgrades:upgrades.map(option=>({id:option.id,rarity:option.rarity})),rewards:rewards.map(reward=>({...reward}))};
  return {scene,variant,player,warmupPlayer,warmupSave,shop,upgrades,rewards,save,expected,waveIndex,waveDuration:getWaveDuration(waveIndex),
    stats:{kills:player.kills,damageDealt:player.damageDealt,damageTaken:player.damageTaken,timeAlive:player.timeAlive},
    metadata:{seed:69,difficulty:'normal',characterId:'yui',partySize:1,scene,variant,
      hudWarmup:'Actual pre-menu playing state, before purchases/levelups. DOM chrome stays frozen; Canvas/SVG bars use current player values. Rich/poor/reward have the same initial player values; sold-locked preserves pre-buy materials/stats/weapons.',
      scope:'Canonical UI staging, not natural campaign. Real old rule methods produce all stats, upgrade values, item/weapon effects, prices and rewards. Save carries only their actual output.'}};
}
export async function canonicalHash(model) {
  const bytes=new TextEncoder().encode(JSON.stringify(model.save));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
'''

REFERENCE_SCRIPT = r'''
import { UI } from './src/ui/ui.js';
import { sprites } from './src/core/assets.js';
import { CHARACTERS } from './src/data/characters.js';
import { buildCanonical, canonicalHash, normalizeScene, scenes } from './canonical.js';
const parameters=new URLSearchParams(location.search), requested=normalizeScene(parameters.get('scene')||'title'), variant=parameters.get('variant')||'rich';
const composite=parameters.get('composite')==='1';
if(composite&&!['title','character'].includes(requested))throw new Error('Composite sampling supports title/character only');
if (parameters.get('freeze') === '0') document.querySelector('#visual-parity-freeze').remove();
const fixture={side:'reference',supportedScenes:scenes,requestedScene:requested,ready:false,mode:composite?'composite':'ui-only',
 canonical:{seed:69,difficulty:'normal',hasSave:false,audioEnabled:true,characterId:'yui',partySize:1},
 sampling:'Animations/transitions disabled on both fixtures unless freeze=0; no backend, runtime or persistence.'};
window.visualParity=fixture;
let difficulty='normal', audioEnabled=true, renderer, readinessRevision=0;
const ui=new UI(), model=await buildCanonical(requested,variant);
fixture.canonicalDataHash=await canonicalHash(model);fixture.canonicalData=model.expected;fixture.metadata=model.metadata;
fixture.warmupDataHash=await canonicalHash({save:model.warmupSave});
fixture.metadata.renderScope=composite?'Real legacy idle background plus real UI, sampled at now=0.':'UI-only with HUD Canvas bars; root idle background is intentionally excluded.';
async function paintHud() {
  const {Renderer}=await import('./src/systems/renderer.js');
  renderer ||= new Renderer(document.querySelector('#game')); renderer.resize();
  renderer.ctx.clearRect(0,0,renderer.width,renderer.height);
  // Scope the shared HUD sampling clock to this synchronous real-method call.
  // Native deadlines/font/image waits continue to use the restored clock.
  const ownClock=Object.getOwnPropertyDescriptor(performance,'now');
  Object.defineProperty(performance,'now',{configurable:true,value:()=>0});
  try { renderer._drawHudBars(renderer.ctx,model.player,renderer.width,renderer.height); }
  finally { if(ownClock)Object.defineProperty(performance,'now',ownClock);else delete performance.now; }
  fixture.hudNow=0;
  fixture.hudViewport={width:innerWidth,height:innerHeight,canvasWidth:renderer.width,canvasHeight:renderer.height};
  fixture.hudRenderer='Actual reference Renderer._drawHudBars only; no Game/full-world render loop.';
}
async function paintComposite() {
  const {Renderer}=await import('./src/systems/renderer.js');
  renderer ||= new Renderer(document.querySelector('#game'));renderer.resize();
  const ownClock=Object.getOwnPropertyDescriptor(performance,'now');
  Object.defineProperty(performance,'now',{configurable:true,value:()=>0});
  try {renderer.renderIdleBackground();}
  finally {if(ownClock)Object.defineProperty(performance,'now',ownClock);else delete performance.now;}
  fixture.backend='canvas2d-reference';fixture.renderNowMs=0;
}
async function done(scene) {
  const revision=++readinessRevision;
  fixture.ready=false;document.body.dataset.visualParityReady='false';
  await document.fonts.ready;
  if(composite&&['title','character'].includes(scene))await paintComposite();
  if (['shop','upgrade','pause','results','endless','hud'].includes(scene)) await paintHud();
  if (scene==='shop' && variant==='sell' && !document.querySelector('.sell-bar')) document.querySelector('[data-slot-idx="0"]')?.click();
  await Promise.all([...document.querySelectorAll('.sprite-img')].map(image=>image.decode().catch(()=>{})));
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  if(revision!==readinessRevision)return;
  fixture.failedImages=[...document.querySelectorAll('.sprite-img')].filter(image=>!image.complete||!image.naturalWidth).map(image=>image.getAttribute('src'));
  fixture.ready=fixture.failedImages.length===0;document.body.dataset.visualParityReady=String(fixture.ready);
}
const action=name=>()=>{fixture.lastAction=name;render('title');};
async function render(scene) {
  fixture.scene=scene;fixture.ready=false;document.body.dataset.visualParityReady='false';
  const showHud=['shop','upgrade','pause','endless','hud'].includes(scene);
  if(showHud||scene==='results') {
    // The old combat tick updated DOM chrome before menu-only mutations. Keep
    // that real pre-menu Player visible; paint bars with the current Player.
    ui.showHud(true);
    ui.updateHud({player:model.warmupPlayer,waveIndex:model.waveIndex,difficultyId:difficulty,waveDuration:model.waveDuration,waveTimeLeft:model.waveDuration,world:{}});
    await document.fonts.ready;await paintHud();
    if(!(renderer._hudShell?.w>0&&renderer._hudShell?.h>0))throw new Error('NOT_VERIFIED: visible reference HUD shell was not cached');
    fixture.hudWarmup={completed:true,phase:'playing',materials:model.warmupPlayer.materials,level:model.warmupPlayer.level,viewport:{...fixture.hudViewport}};
    if(scene==='results')ui.showHud(false);
  } else ui.showHud(false);
  const callback=action('fixture-only-callback');
  if(scene==='title') ui.showTitle({seed:69,hasSave:false,difficulty,audioEnabled,onStart:()=>render('character'),onContinue:callback,
    onSetDifficulty:value=>{difficulty=value;render('title');},onToggleAudio:()=>{audioEnabled=!audioEnabled;render('title');},
    onExit:action('exit'),onFlandreTest:action('flandre-only-callback'),onHalloweenTest:null,onVergilLab:null});
  else if(scene==='character') ui.showCharacterSelect({characters:CHARACTERS,difficulty,onConfirm:callback,onBack:()=>render('title'),
    onSetDifficulty:value=>{difficulty=value;render('character');},onNekoPlay:callback,onDuoPlay:callback,onDuoWatch:callback,onPartyPlay:callback});
  else if(scene==='shop') ui.showShop({player:model.player,shop:model.shop,waveIndex:model.waveIndex,waveIncome:null,pendingRewards:model.rewards,
    onBuy:callback,onReroll:callback,onCombine:callback,onLock:callback,onNext:callback,onSell:callback,onTakeReward:callback,onSellReward:callback});
  else if(scene==='upgrade') ui.showLevelUp({level:model.player.level,options:model.upgrades,onPick:callback});
  else if(scene==='pause') ui.showPause({player:model.player,fxAlpha:100,onFxAlpha:()=>{},pilotOn:false,onTogglePilot:callback,onResume:callback,onQuit:callback,onExit:callback});
  else if(scene==='results') ui.showResult({win:false,player:model.player,waveIndex:model.waveIndex,stats:model.stats,canRetry:model.expected.canRetry,waveRetries:0,totalRetries:0,onRetryWave:callback,onRestart:callback,onTitle:callback});
  else if(scene==='endless') ui.showEndlessPrompt({wave:model.waveIndex+1,player:model.player,stats:model.stats,onContinue:callback,onStop:callback});
  else if(scene==='hud') ui.clearOverlay();
  else throw new Error('NOT_IMPLEMENTED: '+scene);
  void done(scene).catch(error=>{fixture.error=String(error);fixture.ready=false;});
}
window.addEventListener('resize',()=>{
  fixture.resizeCount=(fixture.resizeCount||0)+1;
  if(fixture.scene)void done(fixture.scene).catch(error=>{fixture.error=String(error);fixture.ready=false;});
});
try {
  const itemIds=[...model.player.items.keys(),...model.shop.offers.filter(o=>o.kind==='item').map(o=>o.id),...model.rewards.map(o=>o.id)];
  const weaponIds=[...CHARACTERS.map(c=>c.startWeapon),...model.player.weapons.map(w=>w.def.id),...model.shop.offers.filter(o=>o.kind==='weapon').map(o=>o.id)];
  await sprites.preload({character:CHARACTERS.map(c=>c.id),weapon:weaponIds,item:itemIds}); await render(requested);
} catch(error) {fixture.error=String(error);document.body.dataset.visualParityReady='false';const pre=document.createElement('pre');pre.textContent=fixture.error;document.body.appendChild(pre);}
'''



def reference_html():
    index = (REFERENCE / 'index.html').read_text(encoding='utf-8')
    # Preserve original SVG definitions, HUD, avatar slots and overlay markup.
    # Remove every original script, so accidental index.html navigation cannot
    # run main.js, Game, audio initialization or a NEKO integration bootstrap.
    index = re.sub(r'<script\b[^>]*>[\s\S]*?</script\s*>', '', index, flags=re.IGNORECASE)
    index = index.replace('<head>', '<head>\n<base href="/reference/">\n<style id="visual-parity-freeze">' + FREEZE_CSS + '</style>', 1)
    return index.replace('</body>', '<script type="module">\n' + REFERENCE_SCRIPT + '\n</script>\n</body>', 1).encode('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', default=str(OUTPUT))
    args = parser.parse_args()
    directory = Path(args.directory).resolve()
    if not directory.is_relative_to(OUTPUT.resolve()):
        raise ValueError('All output must stay in this plugin frontend/test-results/visual-parity/')
    for relative in ['index.html', 'styles.css', 'src/ui/ui.js']:
        if not (REFERENCE / relative).is_file():
            raise FileNotFoundError('Read-only reference static/game is incomplete')
    page = reference_html()
    directory.mkdir(parents=True, exist_ok=True)
    log = directory / 'requests.jsonl'

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *values):
            try:
                log.parent.mkdir(parents=True, exist_ok=True)
                with log.open('a', encoding='utf-8') as stream:
                    stream.write(json.dumps({'path': self.path, 'message': fmt % values}) + '\n')
            except OSError:
                pass

        def response(self, body, content_type='text/plain; charset=utf-8', status=200):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            origin = self.headers.get('Origin', '')
            parsed = urlsplit(origin)
            if parsed.scheme == 'http' and parsed.hostname in {'127.0.0.1', 'localhost', '::1'} and parsed.netloc and not parsed.username and parsed.path in {'', '/'} and not parsed.query and not parsed.fragment:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            path = unquote(urlsplit(self.path).path)
            if path == '/reference/canonical.js':
                return self.response(CANONICAL_SCRIPT.encode('utf-8'), 'text/javascript; charset=utf-8')
            if path in ['/', '/reference', '/reference/', '/reference/index.html', '/reference/ui.html']:
                return self.response(page, 'text/html; charset=utf-8')
            if '\\' in path or '\x00' in path or any(part in ['.', '..'] for part in path.split('/')):
                return self.response(b'forbidden', status=403)
            if not path.startswith('/reference/'):
                return self.response(b'not found', status=404)
            relative = path.removeprefix('/reference/')
            if relative == 'src/main.js' or not (relative == 'styles.css' or relative.startswith('assets/') or relative.startswith('src/') and relative.endswith('.js')):
                return self.response(b'not found', status=404)
            file = (REFERENCE / relative).resolve()
            if not file.is_relative_to(REFERENCE) or not file.is_file():
                return self.response(b'not found', status=404)
            try:
                body = file.read_bytes()
            except OSError:
                return self.response(b'unavailable', status=404)
            return self.response(body, mimetypes.guess_type(file.name)[0] or 'application/octet-stream')

        def do_POST(self):
            self.response(b'UI-only read-only fixture; no actions or backend', status=405)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    base = f'http://127.0.0.1:{server.server_port}'
    info = {'kind': 'old-UI-only-visual-reference', 'base': base,
            'title': base + '/reference/ui.html?scene=title', 'character': base + '/reference/ui.html?scene=character',
            'scene_urls': {scene: base + '/reference/ui.html?scene=' + scene for scene in ['title','character','shop','upgrade','pause','results','endless','hud']},
            'canonical_module': base + '/reference/canonical.js',
            'supported_scenes': ['title', 'character', 'shop', 'upgrade', 'pause', 'results', 'endless', 'hud'], 'shop_variants': ['rich','poor','sold-locked','sell','reward'], 'reference': str(REFERENCE),
            'reference_sha256': {name: hashlib.sha256((REFERENCE / name).read_bytes()).hexdigest() for name in ['index.html', 'styles.css', 'src/ui/ui.js']},
            'log_file': str(log), 'sampling': FREEZE_CSS, 'backend': 'none; original main.js is not served or executed'}
    (directory / 'server.json').write_text(json.dumps(info, ensure_ascii=False, indent=2) + '\n')
    print('VISUAL_REFERENCE_READY ' + json.dumps(info, ensure_ascii=False), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
