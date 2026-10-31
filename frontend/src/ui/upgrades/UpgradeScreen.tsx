import type { GameCommand, GameUiSnapshot } from '../../game';
import { UpgradeAutomation } from './UpgradeAutomation';

export function UpgradeScreen({ snapshot, dispatch }: { snapshot: GameUiSnapshot; dispatch(command: GameCommand): void }) {
  const player = snapshot.players[0];
  if (!player) throw new Error('Upgrades require an active player');
  return <div className="screen">
    <h2>{`升级！ Lv.${player.level}`}</h2>
    <UpgradeAutomation enabled={!!snapshot.autoUpgrade} dispatch={dispatch} />
    <div className="char-grid">{snapshot.upgrades.map(option => {
      const rarityName = option.rarityName, rarityColor = option.rarityColor;
      const plain = option.rarity === 'common';
      return <div key={option.id} className={`card${plain ? '' : ' card--rare'}`} data-up={option.id} role="button" tabIndex={0}
        style={plain ? undefined : { borderColor: rarityColor, boxShadow: `0 0 0 1px ${rarityColor}55,0 0 18px ${rarityColor}33` }}
        onClick={() => dispatch({ type: 'choose-upgrade', optionId: option.id, revision: snapshot.revision })}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); dispatch({ type: 'choose-upgrade', optionId: option.id, revision: snapshot.revision }); } }}>
        <div className="card-head"><div className="avatar" style={{ background: `${option.color}22`, borderColor: rarityColor, color: option.color }}>
          {option.icon ? <svg className="up-icon" viewBox="0 0 24 24" width="26" height="26"><use href={`#${option.icon}`} /></svg> : option.glyph}
        </div><div><div className="card-name">{option.name}</div><div className="card-role">升级选项</div></div></div>
        {!plain && <div className="card-rarity" style={{ background: `${rarityColor}22`, borderColor: rarityColor, color: rarityColor }}>{`${rarityName} · 效果 ×${option.mult}`}</div>}
        <div className="card-desc">{option.description}</div>
        <div className="card-stats">{option.effectLines.map((line, index) => <div className="stat-line" key={index}><span>{line}</span></div>)}
          {option.healAll && <div className="stat-line"><span>回复全部生命</span></div>}
          {option.shieldPercent > 0 && <div className="stat-line"><span>{`护盾 ${Math.round(option.shieldPercent)}% 生命上限`}</span></div>}
        </div>
      </div>;
    })}</div>
  </div>;
}
