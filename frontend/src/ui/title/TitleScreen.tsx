import { useState, type CSSProperties } from 'react';
import type { CharacterChoice, DifficultyChoice, DifficultyId, PartySize, RunOptions } from '../../game';
import { version } from '../../../package.json';
import { SpriteIcon } from '../components/SpriteIcon';
import { useT } from '../i18n';

type Challenge = 'flandre' | 'vergil' | 'remilia' | 'halloween';
export interface TitleScreenProps {
  initialSelecting?: boolean;
  characters: readonly CharacterChoice[];
  canContinue: boolean;
  unlockedChallenges: readonly string[];
  difficulties: readonly DifficultyChoice[];
  difficulty: DifficultyId;
  onSetDifficulty(difficulty: DifficultyId): void;
  seed: number;
  audioEnabled: boolean;
  onToggleAudio(): void;
  onExit?(): void;
  onStart(options: RunOptions): void;
  onDuoWatch(): void;
  onChallenge?(challenge: Challenge, options: RunOptions): void;
  onContinue(): void;
  onImportLegacy(): void;
  showLegacyImport?: boolean;
  showExtraChallenges?: boolean;
}

/** React translation of the final reference title/character-select DOM. */
export function TitleScreen(props: TitleScreenProps) {
  const t = useT();
  const [selecting, setSelecting] = useState(props.initialSelecting ?? false);
  const firstCharacter = props.characters[0];
  if (!firstCharacter) throw new Error('Title requires at least one character');
  const [characterId, setCharacter] = useState(firstCharacter.id);
  const choices = props.difficulties, difficulty = props.difficulty;
  const currentDifficulty = choices.find(choice => choice.id === difficulty);
  if (!currentDifficulty) throw new Error(`Missing selected difficulty: ${difficulty}`);
  const text = (key: string, fallback: string) => t(`ui.reference.${key}`, {}, fallback);
  const selectDifficulty = (value: DifficultyId) => {
    props.onSetDifficulty(value);
    // The old onSetDifficulty rebuilds the selection screen with the first card selected.
    if (selecting) setCharacter(firstCharacter.id);
  };
  const start = (partySize: PartySize, pilot: boolean) => props.onStart({ characterId, difficulty, partySize, pilot });
  const challenge = (kind: Challenge) => props.onChallenge?.(kind, { characterId: 'yui', difficulty: 'nightmare', partySize: 1, pilot: false });
  const difficultyBlock = <div className="diff-block">
    <div className="diff-label">{text('difficulty.label', '难度')}</div>
    <div className="diff-row">{choices.map(choice => <button key={choice.id}
      className={`diff-btn ${choice.id === difficulty ? 'active' : ''}`} data-diff={choice.id}
      style={choice.id === difficulty ? { borderColor: choice.color, color: choice.color } : undefined}
      title={selecting ? undefined : text(`difficulty.${choice.id}.description`, choice.description)}
      onClick={() => selectDifficulty(choice.id)}>{text(`difficulty.${choice.id}.name`, choice.name)}</button>)}</div>
    <div className="diff-desc" style={{ color: currentDifficulty.color }}>{text(`difficulty.${currentDifficulty.id}.description`, currentDifficulty.description)}</div>
  </div>;

  if (!selecting) return <div className="title-scene">
    <div className="title-stars" aria-hidden="true">{Array.from({ length: 36 }, (_, index) => <i key={index}
      className={`t-${['pink', 'cyan', 'violet'][index % 3]}`} style={{ left: `${((index * 97.13) % 100).toFixed(1)}%`,
        width: `${2 + ((index * 31) % 4)}px`, height: `${2 + ((index * 31) % 4)}px`,
        animationDuration: `${9 + ((index * 53) % 14)}s`, animationDelay: `${-((index * 29) % 18)}s` }} />)}</div>
    <div className="screen narrow title-panel">
      {[0, 1, 2, 3].map(index => <svg key={index} className="corner-paw" aria-hidden="true"><use href="#i-paw" /></svg>)}
      <div className="title-head"><span className="ear left" aria-hidden="true" />
        <h1>{text('title.heading', '猫娘姐妹')}</h1><span className="ear right" aria-hidden="true" /></div>
      <div className="sub">{text('title.subtitle', '猫娘计划版土豆兄弟 · NEKO Sisters')}<br />
        {text('title.description', '在 20 波围攻中活下来，收集材料，把武器合成到传说品质。')}</div>
      {difficultyBlock}
      <div className="btn-row btn-row-main"><button className="btn primary btn-start" data-act="start"
        onClick={() => { setCharacter(firstCharacter.id); setSelecting(true); }}>{text('title.start', '开始新游戏')}</button></div>
      <div className="btn-row">
        {props.canContinue && <button className="btn" data-act="continue" onClick={props.onContinue}>{text('title.continue', '继续游戏')}</button>}
        <button className="btn small" data-act="audio" onClick={props.onToggleAudio}>{props.audioEnabled !== false ? text('title.audioOn', '🔊 音效开') : text('title.audioOff', '🔇 音效关')}</button>
        {props.onChallenge && <button className="btn small" data-act="flandre-test" style={{ borderColor: '#ff4060', color: '#ff4060' }} onClick={() => challenge('flandre')}>{text('title.flandre', '🐱 直接挑战芙兰！')}</button>}
        {props.showExtraChallenges && props.onChallenge && props.unlockedChallenges.includes('halloween') && <button className="btn small" data-act="halloween-test" style={{ borderColor: '#ff9f43', color: '#ff9f43' }} onClick={() => challenge('halloween')}>{text('title.halloween', '🎃 直接挑战万圣节双猫！')}</button>}
        {props.showExtraChallenges && props.onChallenge && props.unlockedChallenges.includes('vergil') && <button className="btn small" data-act="vergil-lab" style={{ borderColor: '#59f2ff', color: '#59f2ff' }} onClick={() => challenge('vergil')}>{text('title.vergil', '⚔ 挑战：大排档椅子·维吉尔')}</button>}
        {props.onExit && <button className="btn small danger" data-act="exit" onClick={props.onExit}>{text('title.exit', '关闭游戏')}</button>}
        {props.showLegacyImport && <button className="btn small" data-act="import-legacy" onClick={props.onImportLegacy}>{t('ui.action.import')}</button>}
      </div>
      <div className="keys">
        <span className="key"><b>WASD</b>{text('controls.move', ' / 方向键 移动')}</span>
        <span className="key"><b>{text('controls.autoFire', '武器自动开火')}</b></span>
        <span className="key"><b>{text('controls.holdMouse', '按住左键')}</b>{text('controls.aim', ' 所有武器瞄准鼠标方向，松开恢复自动索敌')}</span>
        <span className="key"><b>ESC</b>{text('controls.pause', ' 暂停')}</span>
        <span className="key"><b>M</b>{text('controls.mute', ' 静音')}</span>
      </div>
    </div>
    <div className="title-meta">{`v${version} · ${text('title.seed', '种子')} ${props.seed}`}</div>
  </div>;

  return <div className="screen">
    <h2>{text('character.heading', '选择你的猫娘')}</h2>
    <div className="sub">{text('character.description', '每个角色有不同的初始属性与起始武器，选一个开始这局。')}</div>
    {difficultyBlock}
    <div className="char-grid" id="char-grid">{props.characters.map(character => <div key={character.id}
      className={`card ${character.id === characterId ? 'selected' : ''}`} data-char={character.id}
      role="button" tabIndex={0} aria-pressed={character.id === characterId} onClick={() => setCharacter(character.id)}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setCharacter(character.id); } }}>
      <div className="card-head">
        <SpriteIcon kind="character" id={character.portraitId ?? character.id} className="avatar" glyph={character.glyph}
          style={{ background: `${character.color}22`, borderColor: character.color, color: character.color }} />
        <div><div className="card-name">{t(`content.characters.${character.id}.name`, {}, character.name)}</div>
          <div className="card-role" style={{ background: `${character.color}1f`, borderColor: `${character.color}66`, color: `color-mix(in srgb,${character.color} 74%,#0f1f38)` } as CSSProperties}>{t(`content.characters.${character.id}.role`, {}, character.role)}</div></div>
      </div>
      <div className="card-desc">{t(`content.characters.${character.id}.description`, {}, character.description)}</div>
      <div className="card-stats">{character.statModifiers?.map((modifier, index) => <div className="stat-line" key={`${modifier.statId}-${index}`}>
        <span>{t(`content.stats.${modifier.statId}.name`, {}, modifier.name)}</span><span className={`v ${modifier.value > 0 ? 'up' : 'down'}`}>{`${modifier.value > 0 ? '+' : ''}${modifier.value}${modifier.percent ? '%' : ''}`}</span>
      </div>)}
        {character.startWeapon && <div className="stat-line"><span>{text('character.startWeapon', '初始武器')}</span><span className="v" style={{ color: character.startWeapon.color }}>{t(`content.weapons.${character.startWeapon.id}.name`, {}, character.startWeapon.name)}</span></div>}
      </div>
      {character.ability && character.skill && <div className="char-skill-box">
        <div className="skill-row"><span className="skill-tag ability">{text('character.ability', '能力')}</span><span className="skill-name">{character.ability.name}</span></div>
        <div className="skill-text">{character.ability.text}</div>
        <div className="skill-row"><span className="skill-tag skill">{text('character.skill', '技能')}</span><span className="skill-name">{character.skill.name}</span></div>
        <div className="skill-text">{character.skill.text}</div>
      </div>}
    </div>)}</div>
    <div className="btn-row">
      <button className="btn primary" data-act="go" onClick={() => start(1, false)}>{text('character.go', '用这个角色开始')}</button>
      <button className="btn" data-act="back" onClick={() => setSelecting(false)}>{text('character.back', '返回')}</button>
      <button className="btn" data-act="neko-play" style={{ borderColor: '#ff9ec7', color: '#ff9ec7' }} onClick={() => start(1, true)}>{text('character.nekoPlay', '🐾 猫娘帮你玩')}</button>
      <button className="btn" data-act="duo-play" style={{ borderColor: '#9ec7ff', color: '#9ec7ff' }} onClick={() => start(2, false)}>{text('character.duoPlay', '🐱‍👤 和猫娘一起玩（实验）')}</button>
      <button className="btn" data-act="duo-watch" style={{ borderColor: '#c79eff', color: '#c79eff' }} onClick={() => { if (props.onDuoWatch) props.onDuoWatch(); else start(2, true); }}>{text('character.duoWatch', '👀 看2个猫娘手忙脚乱（实验）')}</button>
    </div>
    <div className="btn-row" style={{ gap: 6 }}>
      <span style={{ fontSize: 12, color: '#8a93a6', alignSelf: 'center' }}>{text('character.party', '猫娘小队：')}</span>
      {([2, 3, 4] as const).map(size => <button key={size} className="btn" data-act={`party-${size}`}
        style={{ borderColor: ({ 2: '#9ec7ff', 3: '#ffd166', 4: '#4cc9f0' })[size], color: ({ 2: '#9ec7ff', 3: '#ffd166', 4: '#4cc9f0' })[size], padding: '4px 12px' }}
        onClick={() => start(size, false)}>{text(`character.party${size}`, `${size}P（+${size - 1}猫娘）`)}</button>)}
    </div>
  </div>;
}
