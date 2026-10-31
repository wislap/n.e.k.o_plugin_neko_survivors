import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { GameUiSnapshot, PlayerSummary, HudChromeFrame } from '../../game';
import { SpriteIcon } from '../components/SpriteIcon';
import { useFloatingTips } from '../components/useFloatingTips';
import { useT } from '../i18n';
import { playerStat } from '../player-stat';
import type { HudDisplay } from '../../app/hud-display';
import { hudRatio as ratio } from './animation';
import { createHudSvgPainter, measureHudGeometry, type HudGeometry, type HudSvgNodes } from './svg-painter';
import { createHudChromePainter } from './chrome-painter';
import { formatMaterials as materials } from '../formatters';
import type { PresentationProfile } from '../../presentation/profile';

const HUD_ASSETS = { paw: './assets/ui/hud-paw-48.png', hatch: './assets/ui/hud-hatch-8.png' } as const;
let decodedHudAssets: Promise<void> | undefined;
/** Decode each immutable offline-generated primitive once per document. */
function decodeHudAssets(): Promise<void> {
  return decodedHudAssets ??= Promise.all(Object.values(HUD_ASSETS).map(source => {
    const image = new Image(); image.src = source; return image.decode();
  })).then(() => undefined, error => { decodedHudAssets = undefined; throw error; });
}
const HUD_STATS = [['damage', 'DMG'], ['attackSpeed', 'AS'], ['critChance', 'CRIT'], ['armor', 'ARM'], ['moveSpeed', 'SPD']] as const;
function hudSvgNodes(root: SVGSVGElement): HudSvgNodes {
  const node = <T extends SVGElement>(name: string): T => {
    const value = root.querySelector<T>(`[data-hud-node="${name}"]`);
    if (!value) throw new Error(`Missing persistent HUD SVG node: ${name}`);
    return value;
  };
  return {
    root, hpGroup: node('hp-group'), xpGroup: node('xp-group'), damage: node('damage'), hpFill: node('hp-fill'), hpHighlight: node('hp-highlight'),
    shield: node('shield'), shieldFill: node('shield-fill'), shieldHighlight: node('shield-highlight'),
    streaks: [node('streak-0'), node('streak-1'), node('streak-2')], hpTexts: [node('hp-stroke'), node('hp-text')],
    xpFill: node('xp-fill'), xpRect: node('xp-rect'), xpHighlight: node('xp-highlight'), xpShadow: node('xp-shadow'),
    swipe: node('swipe'), swipeCircles: [node('trail-1'), node('trail-2'), node('trail-3'), node('swipe-head')],
    levelTexts: [node('level-stroke'), node('level-text')], levelGradient: node('level-gradient'),
  };
}

function hudRoundRect(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2);
  return `M ${x + r} ${y} H ${x + width - r} A ${r} ${r} 0 0 1 ${x + width} ${y + r} V ${y + height - r} A ${r} ${r} 0 0 1 ${x + width - r} ${y + height} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + height - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
}
/** SVG translations of reference Renderer._drawHudBars path/paint commands. */
function HudBars({ presentation, combat, player, geometry, clock, display, chromeRoot, initialChrome }: { presentation: Readonly<PresentationProfile>; combat: boolean; player: PlayerSummary; geometry: HudGeometry; clock?: number; display?: HudDisplay; chromeRoot: RefObject<HTMLDivElement | null>; initialChrome: HudChromeFrame }) {
  const id = useId().replace(/:/g, ''), svg = useRef<SVGSVGElement>(null);
  const painter = useRef<ReturnType<typeof createHudSvgPainter> | undefined>(undefined);
  const [assetState, setAssetState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [assetError, setAssetError] = useState<string>();
  useLayoutEffect(() => {
    let live = true;
    void decodeHudAssets().then(() => { if (live) setAssetState('ready'); }).catch(error => {
      if (live) { setAssetState('failed'); setAssetError(String(error)); }
    });
    return () => { live = false; };
  }, []);
  const { width: W, height: H, hp: shell } = geometry;
  const { x, y, w, h, textX, textY } = shell, inX = x + 2, inY = y + 2, inW = Math.max(0, w - 4), inH = Math.max(0, h - 4);
  const xpY = H - 12, lvY = H - 19;
  const { mobile, resolution: referenceDpr } = presentation;
  const fixedClock = clock !== undefined;
  useLayoutEffect(() => {
    if (!svg.current) return;
    const owner = createHudSvgPainter(hudSvgNodes(svg.current), geometry, { mobile, referenceDpr });
    const chrome = !fixedClock && display && chromeRoot.current ? createHudChromePainter(chromeRoot.current) : undefined;
    // Initialize a mounted continuation/menu once; subsequent menu frames freeze.
    chrome?.paint({ timestampMs: 0, combat: true, hud: null, chrome: initialChrome });
    painter.current = owner;
    // A fixed QA sample never subscribes to or advances the live display channel.
    const disconnect = !fixedClock && display ? display.connect(sample => { owner.paint(sample); chrome?.paint(sample); }) : undefined;
    return () => { owner.dispose(); chrome?.dispose(); disconnect?.(); if (painter.current === owner) painter.current = undefined; };
  }, [display, fixedClock, mobile, referenceDpr]);
  useLayoutEffect(() => {
    painter.current?.relayout(geometry);
    if (clock !== undefined || !display) painter.current?.paint({
      timestampMs: (clock ?? (typeof performance === 'undefined' ? 0 : performance.now() / 1000)) * 1000,
      combat, hud: player,
    });
  }, [geometry, player, combat, clock, display]);
  const ref = (name: string) => `url(#${id}-${name})`;
  const plate = `M ${x + 3} ${y - 4} L ${x + w - 3} ${y - 4} L ${x + w + 4} ${y + h + 4} L ${x - 4} ${y + h + 4} Z`;
  const shadow = (name: string, color: string, opacity: number, blur: number, x0: number, y0: number, width: number, height: number) =>
    <filter id={`${id}-${name}`} x={x0} y={y0} width={width} height={height} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
      <feDropShadow dx="0" dy="0" stdDeviation={mobile ? 0 : blur / (2 * referenceDpr)} floodColor={color} floodOpacity={mobile ? 0 : opacity} />
    </filter>;
  return <svg ref={svg} className="hud-bars-svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H} data-clock-sampled={clock !== undefined || undefined} data-hud-assets-ready={assetState === 'ready'} data-hud-assets-error={assetError}>
    <defs>
      <linearGradient id={`${id}-plate`} gradientUnits="userSpaceOnUse" x1="0" y1={y - 4} x2="0" y2={y + h + 4}><stop stopColor="#fff" /><stop offset=".5" stopColor="#f3f9ff" /><stop offset="1" stopColor="#dcebfa" /></linearGradient>
      <pattern id={`${id}-hatch`} width="8" height="8" patternUnits="userSpaceOnUse"><image href={HUD_ASSETS.hatch} x="0" y="0" width="8" height="8" /></pattern>
      <linearGradient id={`${id}-hp`} gradientUnits="userSpaceOnUse" x1={inX} y1="0" x2={inX + inW} y2="0"><stop stopColor="#8f1220" /><stop offset=".55" stopColor="#e0263c" /><stop offset="1" stopColor="#ff7d9c" /></linearGradient>
      <linearGradient id={`${id}-damage`} gradientUnits="userSpaceOnUse" x1={inX} y1="0" x2={inX + inW} y2="0"><stop stopColor="#ffe9c9" /><stop offset="1" stopColor="#ff9a3a" /></linearGradient>
      <linearGradient id={`${id}-streak`}><stop stopColor="#dcf2ff" stopOpacity="0" /><stop offset=".5" stopColor="#dcf2ff" stopOpacity=".55" /><stop offset="1" stopColor="#dcf2ff" stopOpacity="0" /></linearGradient>
      <clipPath id={`${id}-hp-clip`}><path d={hudRoundRect(inX, inY, inW, inH, 6)} /></clipPath>
      <linearGradient id={`${id}-xp-bg`} gradientUnits="userSpaceOnUse" x1="0" y1={xpY} x2="0" y2={H}><stop stopColor="#fff" stopOpacity=".96" /><stop offset="1" stopColor="#e4f1ff" stopOpacity=".98" /></linearGradient>
      <linearGradient id={`${id}-xp`} gradientUnits="userSpaceOnUse" x1="0" y1={xpY} x2={W} y2={xpY}><stop stopColor="#4aa8ff" /><stop offset=".55" stopColor="#5fc8f5" /><stop offset="1" stopColor="#67d3f0" /></linearGradient>
      <linearGradient id={`${id}-level`} data-hud-node="level-gradient" gradientUnits="userSpaceOnUse" x1="0" x2="0"><stop stopColor="#fff3c4" /><stop offset=".55" stopColor="#ffd23a" /><stop offset="1" stopColor="#f59e0b" /></linearGradient>
      {shadow('hp-shadow', '#ffd68c', .55, 5, textX - 16, textY - 28, W - textX + 32, 56)}
      <filter id={`${id}-xp-shadow`} x="-40" y={xpY - 40} width={W + 80} height="92" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feDropShadow data-hud-node="xp-shadow" dx="0" dy="0" /></filter>
      {shadow('paw-shadow', '#ffd23a', .8, 4, -16, xpY - 16, W + 32, 44)}
      {shadow('swipe-shadow', '#fff', .95, 10, -24, xpY - 24, W + 48, 60)}
      {shadow('level-shadow', '#ffc850', .5, 6, W - 240, lvY - 64, 256, 96)}
      <image id={`${id}-paw`} href={HUD_ASSETS.paw} x="0" y="0" width="48" height="48" />
    </defs>
    <g role="progressbar" data-hud-node="hp-group">
      <path d={plate} fill={ref('plate')} /><path d={plate} fill={ref('hatch')} stroke="rgba(196,220,244,.95)" strokeWidth="1.5" />
      <path d={`M ${x + 6} ${y - 2.5} L ${x + w - 6} ${y - 2.5}`} fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="1" />
      <g>
        <rect data-hud-node="damage" fill={ref('damage')} clipPath={ref('hp-clip')} />
        <rect data-hud-node="hp-fill" fill={ref('hp')} clipPath={ref('hp-clip')} />
        <rect data-hud-node="hp-highlight" fill="rgba(255,255,255,.22)" clipPath={ref('hp-clip')} />
        <g data-hud-node="shield">
          <rect data-hud-node="shield-fill" fill="rgba(120,200,255,.58)" clipPath={ref('hp-clip')} />
          {[0, 1, 2].map(index => <rect key={index} data-hud-node={`streak-${index}`} fill={ref('streak')} opacity=".85" clipPath={ref('hp-clip')} />)}
          <rect data-hud-node="shield-highlight" fill="rgba(210,238,255,.5)" clipPath={ref('hp-clip')} />
        </g>
      </g>
      <path d={hudRoundRect(inX - .5, inY - .5, inW + 1, inH + 1, 7)} fill="none" stroke="rgba(0,0,0,.9)" strokeWidth="1.2" />
      <g fontFamily='"Segoe UI", "Microsoft YaHei", sans-serif' fontSize="15" fontWeight="800" textAnchor="start" dominantBaseline="middle" strokeLinejoin="round">
        <text data-hud-node="hp-stroke" fill="none" stroke="rgba(255,255,255,.95)" strokeWidth="4" filter={ref('hp-shadow')} />
        <text data-hud-node="hp-text" fill="#1d3c63" />
      </g>
    </g>
    <g role="progressbar" data-hud-node="xp-group">
      <rect x="0" y={xpY} width={W} height="12" fill={ref('xp-bg')} /><rect x="0" y={xpY} width={W} height="1" fill="rgba(120,180,240,.35)" />
      <rect x=".5" y={xpY + .5} width={Math.max(0, W - 1)} height="11" fill="none" stroke="rgba(170,205,240,.9)" strokeWidth="1" />
      <g data-hud-node="xp-fill">
        <rect data-hud-node="xp-rect" fill={ref('xp')} filter={ref('xp-shadow')} />
        <rect data-hud-node="xp-highlight" fill="rgba(255,255,255,.3)" />
      </g>
      <g filter={ref('paw-shadow')}>{[.25, .5, .75].map(value => <use key={value} href={`#${id}-paw`} transform={`translate(${W * value - 9} ${xpY - 3}) scale(.375)`} />)}</g>
      <g data-hud-node="swipe" filter={ref('swipe-shadow')}>
        {[1, 2, 3].map(index => <circle key={index} data-hud-node={`trail-${index}`} r={4.5 - index * 1.1} fill="#fff" opacity={.5 - index * .13} />)}
        <circle data-hud-node="swipe-head" r="5" fill="#fff" />
      </g>
    </g>
    <g fontFamily='"Segoe UI", "Microsoft YaHei", sans-serif' fontWeight="800" textAnchor="end" strokeLinejoin="round">
      <text data-hud-node="level-stroke" fill="none" stroke="rgba(10,6,18,.95)" strokeWidth="5" filter={ref('level-shadow')} />
      <text data-hud-node="level-text" fill={ref('level')} />
    </g>
  </svg>;
}

export function Hud({ presentation, snapshot, chromeSnapshot, clock, display, chromeHidden = false }: { presentation: Readonly<PresentationProfile>; snapshot: GameUiSnapshot; chromeSnapshot: GameUiSnapshot; clock?: number; display?: HudDisplay; chromeHidden?: boolean }) {
  const tips = useFloatingTips(snapshot.phase), t = useT(), player = snapshot.players[0];
  const root = useRef<HTMLDivElement>(null), bottom = useRef<HTMLDivElement>(null), hpShell = useRef<HTMLDivElement>(null), hpGhost = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<HudGeometry>();
  useLayoutEffect(() => {
    const node = root.current, bar = hpShell.current, ghost = hpGhost.current, viewport = node?.parentElement;
    if (!node || !bar || !ghost || !viewport) return;
    const measure = () => {
      const bounds = viewport.getBoundingClientRect(), b = bar.getBoundingClientRect(), g = ghost.getBoundingClientRect();
      setGeometry(previous => measureHudGeometry(previous,
        { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, clientWidth: viewport.clientWidth, clientHeight: viewport.clientHeight },
        b, g, chromeHidden));
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(viewport); observer.observe(node); observer.observe(bar); if (bottom.current) observer.observe(bottom.current);
    return () => observer.disconnect();
  }, [player?.id, chromeHidden]);
  if (!player) return null;
  const chrome = chromeSnapshot, chromePlayer = chrome.players[0]!;
  const live = !!display && clock === undefined;
  const initialChrome = { wave: chrome.wave, materials: chromePlayer.materials, secondsLeft: chrome.secondsLeft,
    timerTotal: chrome.timerTotal, timerLabel: chrome.timerLabel, timerVisible: chrome.timerVisible !== false, flandre: chrome.challengeId === 'flandre' };
  const timer = Math.max(0, Math.ceil(chrome.secondsLeft));
  const { name: difficultyName, color: difficultyColor } = chrome.difficultyInfo;
  return <><div id="hud" ref={root} {...tips.events} className={`${chrome.challengeId === 'flandre' ? 'hud-flandre' : ''}${chromeHidden ? ' hidden' : ''}`} aria-label={t('ui.hud.label')}>
    <div className="hud-top">
      <div className="hud-wave"><span className="hud-label">WAVE</span><span id="hud-wave-num">{live ? undefined : chrome.wave}</span>
        <span className="hud-sub">/ {chrome.maxWaves}</span>
        {chrome.difficulty !== 'normal' && <span id="hud-difficulty" className="hud-difficulty" style={{ color: difficultyColor, borderColor: difficultyColor }}>{t(`content.difficulties.${chrome.difficulty}.name`, {}, difficultyName)}</span>}
      </div>
      <div className={live ? 'hud-timer' : `hud-timer${chrome.challengeId === 'flandre' ? ' flandre' : ''}${timer > 0 && timer <= 5 ? ' urgent' : ''}${chrome.timerVisible === false ? ' hidden' : ''}`}>
        <div id="hud-timer-label" style={live ? undefined : { display: chrome.timerLabel ? undefined : 'none' }}>{live ? undefined : chrome.timerLabel}</div>
        <div id="hud-timer-text">{live ? undefined : timer}</div>
        <div className="hud-timer-bar"><div id="hud-timer-fill" style={live ? undefined : { transform: `scaleX(${ratio(chrome.secondsLeft, chrome.timerTotal)})` }} /></div>
      </div>
      <div className="hud-materials"><span className="mat-icon" /><span id="hud-materials">{live ? undefined : materials(chromePlayer.materials)}</span></div>
    </div>
    <div className="hud-bottom" ref={bottom}>
      <div id="hud-weapons" className="hud-weapons">{chromePlayer.weapons.map(weapon => <SpriteIcon key={weapon.instanceId} title={`${weapon.name} Lv.${weapon.level}`} kind="weapon" id={weapon.definitionId} className={`hud-weapon tier-${weapon.tier}`} style={{ color: weapon.color }}>
          <span className="w-glyph">{weapon.glyph}</span>
          {weapon.level > 1 && <span className="w-tag">Lv{weapon.level}</span>}
        </SpriteIcon>)}</div>
      <div id="hud-stats" className="hud-stats">{HUD_STATS.map(([id, short]) => {
        const detail = playerStat(chromePlayer, id);
        return <span className="hud-stat has-tip" key={id} data-tip={detail.description}>{short} <b>{detail.formatted}</b></span>;
      })}</div>
      <div className="hud-hp" aria-hidden="true"><div className="hud-hp-bar" ref={hpShell} /><div id="hud-hp-ghost" ref={hpGhost} /></div>
    </div>
  </div>{geometry && <HudBars presentation={presentation} combat={snapshot.combat} player={player} geometry={geometry} clock={clock} display={display} chromeRoot={root} initialChrome={initialChrome} />}{tips.layer}</>;
}
