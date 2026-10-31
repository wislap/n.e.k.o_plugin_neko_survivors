import simplified from '../../../i18n/zh-CN.json';
import english from '../../../i18n/en.json';
import chinese from '../../../i18n/zh.json';

function localeCoverage(locale: 'en' | 'zh') {
  const dictionary = locale === 'en' ? english : chinese;
  return { missing: Object.keys(simplified).filter(key => !Object.hasOwn(dictionary, key)) };
}
import { Children, createElement, isValidElement, type ComponentType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getDifficultyChoices, getCharacterChoices, type GameUiSnapshot, type PlayerSummary } from '../../src/game';
import { I18nProvider } from '../../src/ui/i18n';
import { createTranslator, resolveLocale } from '../../src/i18n';
import { DESKTOP_PRESENTATION } from '../../src/presentation/profile';
import { playerSummary, weaponSummary, offerSummary, uiSnapshot } from '../support/views';
import { ShopScreen } from '../../src/ui/shop/ShopScreen';
import { UpgradeScreen } from '../../src/ui/upgrades/UpgradeScreen';
import { UpgradeAutomation } from '../../src/ui/upgrades/UpgradeAutomation';
import { TitleScreen } from '../../src/ui/title/TitleScreen';
import { PauseScreen } from '../../src/ui/pause/PauseScreen';
import { ResultsScreen } from '../../src/ui/results/ResultsScreen';
import { GameScreen } from '../../src/ui/GameScreen';
import { Hud } from '../../src/ui/hud/Hud';

const base = uiSnapshot();
const player: PlayerSummary = playerSummary({
  id: 1, name: '悠怡', characterId: 'yui', hp: 20, maxHp: 20, shield: 0, level: 2, xp: 1, xpNeeded: 10,
  materials: 50, kills: 12, downed: false, rerollCost: 17, items: [],
  damageDealt: 1234.5, damageTaken: 67.2, timeAlive: 150.7,
  weapons: [weaponSummary({ instanceId: 1, definitionId: 'cat_paw', name: '猫爪', tier: 1, level: 1, recipe: { targetName: '猫爪·改', targetColor: '#6ee7a8', targetDescription: '', cost: 20, canCombine: false, needMaterials: 0 } })],
});
const snapshot: GameUiSnapshot = { ...base, phase: 'shop', combat: false, wave: 4, players: [player], offers: [
  offerSummary({ id: 'p1', ownerId: 1, name: 'P1 own item', description: 'Own shelf', kind: 'item', definitionId: 'test_p1', price: 10, tier: 1, sold: false, locked: false }),
  offerSummary({ id: 'p2', ownerId: 2, name: 'P2 private item', description: 'Other shelf', kind: 'item', definitionId: 'test_p2', price: 10, tier: 1, sold: false, locked: false }),
] };
const dispatch = vi.fn();
function render<Props extends object>(component: ComponentType<Props>, props: Props, locale: 'en' | 'zh-CN' = 'en') {
  return renderToStaticMarkup(createElement(I18nProvider, { locale, children: createElement(component, props) }));
}

describe('central plugin locales', () => {
  it('selects browser languages and falls back to the Chinese source', () => {
    expect(resolveLocale(['ja-JP', 'en-GB'])).toBe('en');
    expect(resolveLocale(['zh-TW'])).toBe('zh');
    expect(resolveLocale(['fr'])).toBe('zh-CN');
    const t = createTranslator('en');
    expect(t('ui.shop.reroll', { cost: 23 })).toBe('Reroll · 23 materials');
    expect(t('content.weapons.cat_paw.name')).not.toContain('content.');
    expect(t('unknown', {}, 'safe fallback')).toBe('safe fallback');
  });
  it('has complete English interface keys and reports remaining content translation honestly', () => {
    const coverage = localeCoverage('en');
    expect(coverage.missing.filter(key => key.startsWith('ui.'))).toEqual([]);
    expect(coverage.missing.every(key => key.startsWith('content.'))).toBe(true);
    expect(localeCoverage('zh').missing).toEqual([]);
  });
});

describe('public snapshot UI', () => {
  it('keeps host receipts in opt-in pause settings without claiming queued playback', () => {
    const props = { previousStats: {}, snapshot: { ...snapshot, phase: 'paused' as const }, dispatch, showAdvanced: true,
      audio: { enabled: true, master: 1, music: .5, sfx: .5 }, onSave: async () => true, onAudio: vi.fn() };
    const queued = render(PauseScreen, { ...props, hostFeedback: { status: 'queued' as const } });
    expect(queued).toContain('Last request: queued'); expect(queued).not.toContain('request completed'); expect(queued).not.toContain('played');
    const rejected = render(PauseScreen, { ...props, hostFeedback: { status: 'rejected' as const, reason: 'permission_denied' } });
    expect(rejected).toContain('Last request: rejected'); expect(rejected).toContain('title="permission_denied"');
    const title = render(GameScreen, { presentation: DESKTOP_PRESENTATION, snapshot: base, characters: getCharacterChoices(), canContinue: false,
      audio: props.audio, dispatch, onContinue: vi.fn(), onImportLegacy: vi.fn(), onSave: props.onSave, onAudio: props.onAudio,
      hostFeedback: { status: 'queued' as const } });
    expect(title).not.toContain('Last request:');
  });
  it('preserves reference shop columns, six weapon slots and game-provided costs', () => {
    const html = render(ShopScreen, { snapshot, dispatch });
    expect(html).toContain('第 4 波结束 · 商店');
    expect(html).toMatch(/class="shop-body">[\s\S]*class="shop-char has-tip"[\s\S]*class="shop-main"[\s\S]*class="stat-panel"/);
    expect(html.match(/class="weapon-slot(?: [^"]*)?"/g)).toHaveLength(6);
    expect(html).toContain('P1 own item'); expect(html).not.toContain('P2 private item');
    expect(html).toContain('刷新（17 材料）'); expect(html).toMatch(/disabled=""[^>]*>合成（20 材料）/);
    expect(html).toContain('点击可出售'); expect(html).toContain('进入第 5 波');
  });
  it('keeps E/Q actions in the original upgrade help line without a new button row', () => {
    const html = render(UpgradeScreen, { snapshot: { ...snapshot, phase: 'upgrade' }, dispatch });
    expect(html).toContain('<h2>升级！ Lv.2</h2>'); expect(html).toContain('选一个强化。');
    expect(html).toContain('自动选一次'); expect(html).toContain('本局升级全自动（下一局自动关闭）');
    expect(html).toMatch(/<b[^>]*role="button"[^>]*>E<\/b>/); expect(html).toMatch(/<b[^>]*role="button"[^>]*>Q<\/b>/);
    expect(html).not.toContain('<button'); expect(html).toContain('class="char-grid"');
  });
  it('retains original rarity, effect rows and game-provided stat tooltip', () => {
    const html = render(UpgradeScreen, { snapshot: { ...snapshot, phase: 'upgrade', combat: false, upgrades: [{
      id: 'up_maxhp', name: '强健体魄', description: '最大生命 +6。', rarity: 'legendary', color: '#ff5f6d',
      rarityName: '传说', rarityColor: '#ffa726', mult: 3, icon: 'i-heart', glyph: '心', effectLines: ['+18 最大生命'],
      healAll: true, shieldPercent: 150,
    }] }, dispatch });
    expect(html).toContain('class="card card--rare"'); expect(html).toContain('href="#i-heart"'); expect(html).toContain('传说 · 效果 ×3');
    expect(html).toContain('class="card-desc">最大生命 +6。'); expect(html).toContain('class="stat-line"><span>+18 最大生命</span>');
    expect(html.match(/回复全部生命/g)).toHaveLength(1); expect(html.match(/护盾 150% 生命上限/g)).toHaveLength(1);
    expect(html).not.toContain('Base effect:'); expect(html).not.toContain('Actual effects');
    const shop = render(ShopScreen, { snapshot: { ...snapshot, players: [{ ...player, statDetails: player.statDetails.map(detail => detail.statId === 'armor'
      ? { ...detail, value: 30, formatted: '30', description: '减伤 50.0%，实际只承受 50.0% 伤害。' } : detail) }] }, dispatch });
    expect(shop).toContain('data-tip="减伤 50.0%，实际只承受 50.0% 伤害。"'); expect(shop).toContain('class="sp-v">30');
  });
  it('keeps the original title and explicitly gates legacy import and extra challenge entries', () => {
    const props = { characters: getCharacterChoices(), canContinue: true, difficulties: getDifficultyChoices(), difficulty: 'normal' as const,
      onSetDifficulty: vi.fn(), seed: 1, audioEnabled: true, onToggleAudio: vi.fn(), onDuoWatch: vi.fn(), unlockedChallenges: ['vergil'],
      onStart: vi.fn(), onChallenge: vi.fn(), onContinue: vi.fn(), onImportLegacy: vi.fn() };
    const html = render(TitleScreen, props);
    expect(html).toContain('class="title-scene"'); expect(html).toContain('class="screen narrow title-panel"');
    expect(html).toContain('开始新游戏'); expect(html).toContain('继续游戏'); expect(html).toContain('data-act="flandre-test"');
    expect(html).not.toContain('data-act="vergil-lab"'); expect(html).not.toContain('data-act="halloween-test"'); expect(html).not.toContain('data-act="import-legacy"');
    const advanced = render(TitleScreen, { ...props, showLegacyImport: true, showExtraChallenges: true });
    expect(advanced).toContain('data-act="vergil-lab"'); expect(advanced).not.toContain('data-act="halloween-test"'); expect(advanced).toContain('data-act="import-legacy"');
    const rootProps = { presentation: DESKTOP_PRESENTATION, snapshot: base, characters: props.characters, canContinue: true,
      audio: { enabled: true, master: 1, music: .5, sfx: .5 }, dispatch, onContinue: props.onContinue,
      onImportLegacy: props.onImportLegacy, onSave: async () => true, onAudio: vi.fn() };
    expect(render(GameScreen, rootProps)).not.toContain('data-act="import-legacy"');
    expect(render(GameScreen, { ...rootProps, showAdvanced: true })).toContain('data-act="import-legacy"');
  });
  it('keeps original pause actions by default and retained utilities in opt-in settings', () => {
    const props = { previousStats: {}, snapshot: { ...snapshot, phase: 'paused' as const, autoUpgrade: true }, dispatch,
      audio: { enabled: true, master: 1, music: .5, sfx: .5 }, onAudio: vi.fn(), onSave: vi.fn(), onExit: vi.fn() };
    const normal = render(PauseScreen, props, 'zh-CN');
    expect(normal).toContain('class="pause-title"'); expect(normal).toContain('已暂停'); expect(normal).toContain('当前属性一览');
    expect(normal).toContain('猫娘帮你玩：关'); expect(normal).toContain('继续游戏'); expect(normal).toContain('放弃本局'); expect(normal).toContain('关闭游戏');
    expect(normal).not.toContain('<summary'); expect(normal).not.toContain('<fieldset');
    const advanced = render(PauseScreen, { ...props, showAdvanced: true });
    expect(advanced).toContain('Save and return to title'); expect(advanced).toContain('Disable auto-upgrade'); expect(advanced).toContain('Sound effects');
  });
  it('keeps audio resource and gesture problems understandable in the settings panel', () => {
    const props = { previousStats: {}, snapshot: { ...snapshot, phase: 'paused' as const }, dispatch, showAdvanced: true,
      audio: { enabled: false, master: 1, music: .5, sfx: .5 }, onAudio: vi.fn(), onSave: async () => true };
    const failed = render(PauseScreen, { ...props, audioIssue: { reason: 'music file HTTP 404', recoverable: false, waitingForGesture: false, resource: 'missing.ogg' } });
    expect(failed).toContain('Audio is unavailable: music file HTTP 404');
    expect(failed).toContain('title="missing.ogg"');
    const waiting = render(PauseScreen, { ...props, audioIssue: { reason: 'autoplay blocked', recoverable: true, waitingForGesture: true } });
    expect(waiting).toContain('waiting for a click or key press');
    const interrupted = render(PauseScreen, { ...props, audioIssue: { reason: 'media request aborted', recoverable: true, waitingForGesture: false } });
    expect(interrupted).toContain('Audio is temporarily unavailable; you can retry: media request aborted');
    expect(interrupted).not.toContain('waiting for a click or key press');
  });
  it('renders original result rows using public counters and conditional retries', () => {
    const html = render(ResultsScreen, { snapshot: { ...snapshot, phase: 'endless-prompt', won: true }, dispatch, onRestart: vi.fn() });
    expect(html).toContain('class="screen narrow"'); expect(html).toContain('继续挑战（无限模式）'); expect(html).toContain('见好就收，结算');
    for (const [name, value] of [['击杀数', '12'], ['造成伤害', '1235'], ['承受伤害', '67'], ['存活时间', '150 秒']]) {
      expect(html).toContain(`<div class="k">${name}</div><div class="v">${value}</div>`);
    }
    expect(html).not.toContain('重试次数');
    const retry = render(ResultsScreen, { snapshot: { ...snapshot, phase: 'result', combat: false, won: false, canRetry: true, retryStats: { wave: 2, total: 5, manual: 3 } }, dispatch, onRestart: vi.fn() });
    expect(retry).toContain('本波 2 次（累计 5 次）'); expect(retry).toContain('重试第 4 波');
  });
  it('keeps the E one-shot action separate from the Q persistent toggle', () => {
    const send = vi.fn();
    const tree = UpgradeAutomation({ enabled: false, dispatch: send });
    const buttons: (() => void)[] = [];
    const visit = (nodes: ReactNode) => Children.forEach(nodes, node => {
      if (!isValidElement<{ children?: ReactNode; role?: string; onClick?: () => void }>(node)) return;
      if ((node.type === 'button' || node.props.role === 'button') && node.props.onClick) buttons.push(node.props.onClick);
      if (node.props.children) visit(node.props.children);
    });
    visit(tree);
    expect(buttons).toHaveLength(2); buttons[0]!(); buttons[1]!();
    expect(send.mock.calls.map(call => call[0])).toEqual([{ type: 'auto-upgrade' }, { type: 'set-auto-upgrade', enabled: true }]);
  });
  it('keeps the default multiplayer shop on P1 without a new buyer selector', () => {
    const html = render(ShopScreen, { snapshot: { ...snapshot, players: [player, { ...player, id: 2, name: 'P2 buyer', rerollCost: 33 }] }, dispatch });
    expect(html).toContain('P1 own item'); expect(html).not.toContain('P2 private item');
    expect(html).toContain('刷新（17 材料）'); expect(html).not.toContain('刷新（33 材料）');
    expect(html).not.toContain('<select'); expect(html).not.toContain('选择买家货架'); expect(html).not.toContain('P2 buyer'); expect(html).not.toContain('role="menu"');
  });
  it('takes capacity, display values and rarity identity from the public projection', () => {
    const adapted = playerSummary({ materials: 1234567, maxWeapons: 3, weapons: [],
      statDetails: player.statDetails.map(detail => ({ ...detail, formatted: `projected-${detail.statId}` })) });
    const data = uiSnapshot({ phase: 'shop', players: [adapted], maxWaves: 7,
      difficulty: 'hard', difficultyInfo: { id: 'hard', name: 'Rule difficulty', color: '#abcdef', description: '' } });
    const shop = render(ShopScreen, { snapshot: data, dispatch });
    expect(shop).toContain('最多 3 把'); expect(shop.match(/class="weapon-slot"/g)).toHaveLength(3);
    expect(shop).toContain('1.2m'); expect(shop).toContain('projected-armor');
    const hud = render(Hud, { snapshot: data, chromeSnapshot: data, presentation: DESKTOP_PRESENTATION, clock: 0 });
    expect(hud).toContain('/ 7'); expect(hud).toContain('#abcdef'); expect(hud).toContain('projected-armor');
    expect(hud).toContain('1.2m');
    const pause = render(PauseScreen, { snapshot: data, previousStats: {}, dispatch,
      audio: { enabled: true, master: 1, music: .5, sfx: .5 }, onAudio: vi.fn(), onSave: async () => true });
    expect(pause).toContain('projected-armor');
    const option = { id: 'translated', name: 'Translated rarity', description: '', rarity: 'common' as const,
      color: '#ffffff', rarityColor: '#abcdef', rarityName: 'Common', mult: 1,
      effectLines: ['Authoritative effect wording'], healAll: false, shieldPercent: 0 };
    const plain = render(UpgradeScreen, { snapshot: { ...data, upgrades: [option] }, dispatch });
    expect(plain).not.toContain('card--rare'); expect(plain).toContain('Authoritative effect wording');
    const rare = render(UpgradeScreen, { snapshot: { ...data, upgrades: [{ ...option, rarity: 'rare', rarityName: '普通' }] }, dispatch });
    expect(rare).toContain('card--rare');
  });

});
