import { formatMaterials as materials } from '../formatters';
import { useState, type CSSProperties } from 'react';
import { useFloatingTips } from '../components/useFloatingTips';
import type { GameCommand, GameUiSnapshot } from '../../game';
import { SpriteIcon } from '../components/SpriteIcon';
import { playerStat } from '../player-stat';

const groups: readonly (readonly [string, readonly string[]])[] = [
  ['攻击', ['damage', 'attackSpeed', 'critChance', 'critDamage', 'lifesteal']],
  ['防御', ['maxHp', 'armor', 'dodge', 'hpRegen']],
  ['机动', ['moveSpeed', 'pickupRange']], ['收益', ['luck', 'harvesting']],
];
function tint(color = '#ffffff'): CSSProperties { return { background: `${color}22`, borderColor: color, color }; }
function PawMark() {
  return <div className="paw-mark" title="小小猫娘帮你拿到的"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <ellipse cx="12" cy="15.5" rx="5.2" ry="4.4" /><ellipse cx="5.2" cy="9.4" rx="2.5" ry="2.9" />
    <ellipse cx="9.6" cy="5.6" rx="2.5" ry="2.9" /><ellipse cx="14.4" cy="5.6" rx="2.5" ry="2.9" /><ellipse cx="18.8" cy="9.4" rx="2.5" ry="2.9" />
  </svg></div>;
}

/** Selection and sale confirmation are local; prices and effects come from the session. */
export function ShopScreen({ snapshot, dispatch }: { snapshot: GameUiSnapshot; dispatch(command: GameCommand): void }) {
  const [selectedSlot, setSelectedSlot] = useState<number>();
  const tips = useFloatingTips(snapshot.revision);
  const player = snapshot.players[0];
  if (!player) throw new Error('Shop requires an active player');
  const revision = snapshot.revision, playerId = player.id;
  const offers = snapshot.offers.filter(offer => offer.ownerId === playerId);
  const rerollCost = player.rerollCost;
  const selected = selectedSlot === undefined ? undefined : player.weapons[selectedSlot];
  const combinations = player.weapons.flatMap((weapon, index, all) => {
    const recipe = weapon.recipe;
    return recipe && all.findIndex(value => value.definitionId === weapon.definitionId) === index ? [{ weapon, recipe }] : [];
  });
  const statGroups = player.weapons.some(weapon => weapon.kind === 'turret') ? [...groups, ['炮台', ['turretDamage', 'turretRate', 'turretRange', 'turretMax']] as const] : groups;
  const income = player.waveIncome;
  return <div className="screen shop-screen" {...tips.events}>
    <div className="shop-head"><div><h2>{`第 ${snapshot.wave} 波结束 · 商店`}</h2><div className="sub" style={{ margin: 0 }}>买武器和道具，或者把两把相同武器合成更强的。</div></div>
      <div className="shop-money"><span className="mat-icon" />{materials(player.materials)}</div></div>
    <div className="shop-body">
      <div className="shop-char has-tip" data-tip={player.characterTip}>
        <SpriteIcon kind="character" id={player.characterId} className="avatar shop-char-avatar" style={tint(player.color)}>{player.glyph}</SpriteIcon>
        <div className="shop-char-name">{player.name}</div><div className="hint">鼠标放上看能力 / 技能</div>

      </div>
      <div className="shop-main">
        {snapshot.rewards.length > 0 && <><div className="sec-label" style={{ color: 'var(--gold)' }}>{`宝箱战利品（${snapshot.rewards.length} 件 · 选择留下或卖掉）`}</div><div className="char-grid">
          {snapshot.rewards.map((reward, rewardIndex) => <div className="card" style={{ cursor: 'default', borderColor: reward.color }} key={reward.id}>
            <div className="card-head"><SpriteIcon kind="item" id={reward.definitionId} className="avatar" style={tint(reward.color)}>{reward.glyph}</SpriteIcon>
              <div><div className="card-name">{reward.name}{reward.rare && <span style={{ color: 'var(--gold)' }}> ★</span>}</div><div className="card-role">战利品</div></div></div>
            <div className="card-desc">{reward.description}</div><div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
              <button className="btn small primary" data-take-reward={rewardIndex} onClick={() => dispatch({ type: 'claim-reward', rewardId: reward.id, revision })}>留下</button>
              <button className="btn small danger" data-sell-reward={rewardIndex} onClick={() => dispatch({ type: 'sell-reward', rewardId: reward.id, revision })}>{`卖掉 +${reward.sellValue}`}</button></div>
          </div>)}</div></>}
        <div className="sec-label">{`武器栏（最多 ${player.maxWeapons} 把 · 点击可出售）`}</div>
        <div className="weapon-tray">{Array.from({ length: player.maxWeapons }, (_, index) => {
          const weapon = player.weapons[index];
          return weapon ? <SpriteIcon kind="weapon" id={weapon.definitionId} key={weapon.instanceId}
            className={`weapon-slot filled tier-${weapon.tier}${weapon.recipe ? ' combinable' : ''}${selectedSlot === index ? ' selected' : ''}`}
            style={{ '--tier-color': weapon.tierColor } as CSSProperties} data-slot-idx={index} data-tip={weapon.tooltip}
            title={`${weapon.name} Lv.${weapon.level} · ${weapon.tierName}（点击查看出售）`}
            role="button" tabIndex={0} onClick={() => setSelectedSlot(selectedSlot === index ? undefined : index)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedSlot(selectedSlot === index ? undefined : index); } }}>
            <span className="w-glyph" style={{ color: weapon.color }}>{weapon.glyph}</span>{weapon.level > 1 && <span className="w-tag">{`Lv${weapon.level}`}</span>}
            <span className="slot-name">{weapon.name}</span><span className="slot-tier" style={{ color: weapon.tierColor }}>{weapon.tierName}</span><span className="slot-sell">{`出售 +${weapon.sellValue}`}</span>
          </SpriteIcon> : <div className="weapon-slot" key={`empty-${index}`}><span style={{ color: '#4a5270' }}>＋</span></div>;
        })}</div>
        {selected && <div className="sell-bar"><span>要卖掉 <b style={{ color: selected.color }}>{selected.name}{selected.level > 1 ? ` Lv.${selected.level}` : ''}</b> 吗？</span>
          <span className="hint">{`可换回 ${selected.sellValue} 材料`}</span><button className="btn small danger" data-act="confirm-sell" onClick={() => { dispatch({ type: 'sell-weapon', weaponInstanceId: selected.instanceId, revision, playerId }); setSelectedSlot(undefined); tips.clear(); }}>确认出售</button>
          <button className="btn small" data-act="cancel-sell" onClick={() => setSelectedSlot(undefined)}>取消</button></div>}
        <div className="sec-label">商品</div><div className="char-grid">{offers.map((offer, index) => {
          const afford = !offer.sold && player.materials >= offer.price;
          return <div className={`card tier-${offer.tier}${offer.locked ? ' locked' : ''}${offer.sold ? ' sold' : ''}${offer.sold || !afford ? ' cant-afford' : ''}${offer.tooltip ? ' has-tip' : ''}`} data-slot={index} data-tip={offer.tooltip} key={offer.id}>
            <div className={`tier-badge t${offer.tier}`} style={{ color: offer.tierColor }}>{offer.tierName}</div>{offer.locked && <div className="lock-badge">🔒 已锁定</div>}{offer.pawMark && <PawMark />}
            <div className="card-head"><SpriteIcon kind={offer.kind} id={offer.definitionId} className="avatar" style={tint(offer.color)}>{offer.glyph}</SpriteIcon>
              <div><div className="card-name">{offer.name}</div><div className="card-role">{offer.kind === 'weapon' ? `武器 · ${offer.behaviorLabel}` : '道具'}{offer.ownedCount ? ` · 已有 ${offer.ownedCount}` : ''}</div></div></div>
            <div className="card-desc">{offer.description}</div><div className="card-stats">{offer.statRows.map((row, index) => <div className="stat-line" key={`${row.label}-${index}`}><span>{row.label}</span><span className={`v${row.tone ? ` ${row.tone}` : ''}`}>{row.value}</span></div>)}</div>
            <div className="shop-foot" style={{ marginTop: 10 }}><span className="price-tag" style={{ position: 'static' }}>{`${offer.price} 材料`}</span>{!afford && !offer.sold && <span className="hint" style={{ color: 'var(--red)' }}>材料不足</span>}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}><button className="btn small" data-buy={index} disabled={!afford} onClick={() => dispatch({ type: 'buy-offer', offerId: offer.id, revision, playerId })}>{offer.sold ? '已售出' : '购买'}</button>
              <button className={`btn small${offer.locked ? ' primary' : ''}`} data-lock={index} disabled={offer.sold} onClick={() => dispatch({ type: 'toggle-lock', offerId: offer.id, revision, playerId })}>{offer.locked ? '解锁' : '锁定'}</button></div>
          </div>;
        })}</div>
        <div className="sec-label">合成</div>{combinations.length ? <div className="char-grid">{combinations.map(({ weapon, recipe }) => <div className="card" key={weapon.definitionId} style={{ cursor: 'default', borderColor: recipe.canCombine ? '#6ee7a8' : 'var(--line)' }}>
          <div className="card-head"><SpriteIcon kind="weapon" id={weapon.definitionId} className="avatar" style={tint(weapon.color)}>{weapon.glyph}</SpriteIcon><div><div className="card-name">{`${weapon.name} × 2`}</div>
            <div className="card-role">合成 → <span style={{ color: recipe.targetColor }}>{recipe.targetName}</span></div></div></div>
          <div className="card-desc">{recipe.targetDescription}</div><div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
            <button className="btn small primary" data-combine={weapon.definitionId} disabled={!recipe.canCombine} onClick={() => dispatch({ type: 'combine', weaponId: weapon.definitionId, revision, playerId })}>{`合成（${recipe.cost} 材料）`}</button>
            {!recipe.canCombine && !!recipe.needMaterials && <span className="hint">{`还差 ${recipe.needMaterials} 材料`}</span>}</div>
        </div>)}</div> : <div className="hint">收集两把相同武器即可在这里合成更强力的武器。</div>}
      </div>
      <aside className="stat-panel"><div className="sp-head"><span className="sp-name">{player.name}</span><span className="sp-lv">{`Lv.${player.level}`}</span></div>
        <div className="sp-hp"><div className="sp-hp-bar"><i style={{ width: `${Math.max(0, player.hp / player.maxHp * 100)}%` }} /></div><div className="sp-hp-text">{`${Math.ceil(player.hp)} / ${Math.round(player.maxHp)}`}{player.hp >= player.maxHp && <span style={{ color: 'var(--green)' }}> 满血</span>}</div></div>
        {statGroups.map(([title, keys]) => <div className="sp-sec" key={title}><div className="sp-title">{title}</div>{keys.map(key => { const detail = playerStat(player, key); return <div className="sp-row has-tip" data-tip={detail.description} key={key} tabIndex={0}><span className="sp-k">{detail.name}</span><span className="sp-v">{detail.formatted}</span><span className="sp-info">?</span></div>; })}</div>)}
        {!!player.items.length && <div className="sp-sec"><div className="sp-title">{`道具（${player.items.length} 种）`}</div>{player.items.map(item => <div className="sp-row has-tip" data-tip={item.tooltip} key={item.id} tabIndex={0}><span className="sp-k" style={{ color: item.color }}>{item.name}</span><span className="sp-v">{`×${item.count}`}</span></div>)}</div>}
        {income && <div className="sp-sec"><div className="sp-title">本波收入</div><div className="sp-row"><span className="sp-k">击杀掉落</span><span className="sp-v" style={{ color: 'var(--gold)' }}>{`+${income.total - income.harvest - income.clear}`}</span></div>
          {income.harvest > 0 && <div className="sp-row"><span className="sp-k">收获属性</span><span className="sp-v" style={{ color: 'var(--gold)' }}>{`+${income.harvest}`}</span></div>}
          <div className="sp-row"><span className="sp-k">波次奖励</span><span className="sp-v" style={{ color: 'var(--gold)' }}>{`+${income.clear}`}</span></div><div className="sp-row sp-total"><span className="sp-k">合计</span><span className="sp-v">{`+${income.total}`}</span></div></div>}
      </aside>
    </div>
    <div className="shop-foot"><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn" data-act="reroll" disabled={player.materials < rerollCost} onClick={() => dispatch({ type: 'reroll', revision, playerId })}>{`刷新（${rerollCost} 材料）`}</button><span className="hint">🔒 锁定的商品会在下一家商店保留</span></div>
      <button className="btn primary" data-act="next" onClick={() => dispatch({ type: 'next-wave' })}>{`进入第 ${snapshot.wave + 1} 波`}</button></div>
    {tips.layer}
  </div>;
}
