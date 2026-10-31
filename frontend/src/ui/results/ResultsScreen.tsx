import type { GameCommand, GameUiSnapshot } from '../../game';
import { useT } from '../i18n';

export function ResultsScreen({ snapshot, dispatch, onRestart }: { snapshot: GameUiSnapshot; dispatch(command: GameCommand): void; onRestart(): void }) {
  const t = useT(), player = snapshot.players[0], endlessPrompt = snapshot.phase === 'endless-prompt';
  if (!player) throw new Error('Results require an active player');
  const win = snapshot.won || endlessPrompt, canRetry = !endlessPrompt && !snapshot.won && snapshot.canRetry;
  const rows: [string, string | number][] = [
    ['到达波次', `${snapshot.wave} / ${endlessPrompt ? snapshot.wave : Math.max(snapshot.maxWaves, snapshot.wave)}`],
    ['击杀数', player.kills], ['造成伤害', Math.round(player.damageDealt)], ['承受伤害', Math.round(player.damageTaken)],
    ['角色等级', player.level], ['存活时间', `${Math.floor(player.timeAlive)} 秒`],
  ];
  if (!endlessPrompt && (snapshot.retryStats.wave > 0 || snapshot.retryStats.total > 0)) rows.push(['重试次数', snapshot.retryStats.wave > 0
    ? `本波 ${snapshot.retryStats.wave} 次（累计 ${snapshot.retryStats.total} 次）` : `累计 ${snapshot.retryStats.total} 次`]);
  const heading = win ? '通关！' : '被击倒了…';
  const summary = endlessPrompt ? <>{`你带着猫娘们撑过了全部 ${snapshot.wave} 波。要进入`}<b>无限模式</b>继续吗？</>
    : win ? snapshot.wave > snapshot.maxWaves ? `无限模式打到了第 ${snapshot.wave} 波。猫娘们都看呆了。` : `你带着猫娘们撑过了全部 ${snapshot.maxWaves} 波。真是个了不起的指挥官。`
      : `在第 ${snapshot.wave} 波倒下了。${canRetry ? '要直接从这一波再来一次吗？' : '再来一次？'}`;
  return <section className="screen narrow" role="dialog" aria-modal="true" aria-label={heading}>
    <h1 style={{ fontSize: endlessPrompt ? 30 : 32 }}>{heading}</h1><div className="sub">{summary}</div>
    <div className="result-stats">{rows.map(([label, value]) => <div className="result-stat" key={label}><div className="k">{label}</div><div className="v">{value}</div></div>)}</div>
    {endlessPrompt ? <>
      <div className="card-desc" style={{ margin: '12px 0' }}>第 {snapshot.maxWaves + 1} 波起敌人属性与数量翻倍；Boss 会以 1 → 2 → 3 → 4 只的规模 轮番登场，间隔越来越短，后期每波都是四连决战——见好就收也是 一种勇气。</div>
      <div className="btn-row"><button className="btn primary" onClick={() => dispatch({ type: 'continue-endless' })}>继续挑战（无限模式）</button>
        <button className="btn" onClick={() => dispatch({ type: 'finish-run' })}>见好就收，结算</button></div>
    </> : <>
      {canRetry && <div className="sub" style={{ marginTop: 14, opacity: .75 }}>重试会回到这一波刚开局的样子（等级、武器、材料都保留）。</div>}
      <div className="btn-row">{canRetry && <button className="btn primary" onClick={() => dispatch({ type: 'retry-wave' })}>{`重试第 ${snapshot.wave} 波`}</button>}
        <button className={`btn${canRetry ? '' : ' primary'}`} onClick={onRestart}>{canRetry ? '从第 1 波重开' : '再来一局'}</button>
        <button className="btn" onClick={() => dispatch({ type: 'return-title' })}>{t('ui.action.title')}</button>
      </div>
    </>}
  </section>;
}
