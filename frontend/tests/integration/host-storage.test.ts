import { describe, expect, it, vi } from 'vitest';
import { createHost } from '../../src/host';
import { createSaveRepository, type StoragePort } from '../../src/storage';
function memoryStorage() {
  const values = new Map<string, string>();
  const storage: StoragePort = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
  return { values, storage };
}
describe('save repository isolation', () => {
  it('imports a validated legacy value without changing legacy keys', () => {
    const { values, storage } = memoryStorage();
    const legacy = JSON.stringify({ version: 1, wave: 7 });
    values.set('neko_miao_save_v1', legacy);
    const saves = createSaveRepository(storage);
    expect(saves.importLegacyProgress(data => data)).toEqual({ ok: true, value: { run: { version: 1, wave: 7 }, meta: null } });
    expect(values.get('neko_miao_save_v1')).toBe(legacy);
    expect(saves.read('run')).toEqual({ ok: true, value: { version: 1, wave: 7 } });
    storage.removeItem('neko_survivors_react:run:v2');
    expect(values.get('neko_miao_save_v1')).toBe(legacy);
  });
  it('rejects invalid old saves and reports quota failure', () => {
    const { values, storage } = memoryStorage();
    values.set('neko_miao_save_v1', '{');
    expect(createSaveRepository(storage).importLegacyProgress(data => data).ok).toBe(false);
    storage.setItem = () => { throw new Error('quota'); };
    expect(createSaveRepository(storage).writeProgress({run:{},meta:null})).toMatchObject({ ok: false, error: 'write_failed' });
  });
  it('preserves existing developer saves during legacy import', () => {
    const { values, storage } = memoryStorage();
    values.set('neko_miao_save_v1', JSON.stringify({ wave: 9 }));
    const saves = createSaveRepository(storage);
    storage.setItem('neko_survivors_react:run:v2', JSON.stringify({ wave: 2 }));
    expect(saves.importLegacyProgress(() => { throw new Error('must not run'); })).toEqual({ ok: true, value: null });
    expect(saves.read('run')).toEqual({ ok: true, value: { wave: 2 } });
  });
});
describe('NEKO host adapter', () => {
  const location = { origin: 'http://localhost:48916', pathname: '/plugin/neko_survivors_react/ui/index.html' };
  const reply = (status: string) => new Response(JSON.stringify({ result: { status } }));
  it('uses only this plugin, and distinguishes a route opening from message submission', async () => {
    const fetcher = vi.fn().mockImplementation((url: URL) => Promise.resolve(url.pathname === '/security/csrf-token'
      ? Response.json({ csrf_token: 'host-test-token' }) : reply(url.pathname.endsWith('/game_event') ? 'submitted' : 'completed')));
    const host = createHost({ location, fetch: fetcher });
    expect(await host.resetSession()).toMatchObject({ status: 'completed' });
    expect(await host.report('wave_start', 'wave 2')).toMatchObject({ status: 'submitted' });
    const call = fetcher.mock.calls.find(call => String(call[0]).endsWith('/game_event'))!;
    expect(String(call[0])).toBe('http://localhost:48916/plugin/neko_survivors_react/hosted-ui/action/game_event');
    expect(JSON.parse(call[1].body)).toMatchObject({ surface_id: 'main', args: { event: 'wave_start' } });
    await host.closeSession(); host.dispose();
    expect(await host.speak('old session')).toMatchObject({ status: 'cancelled' });
  });
  it('does not send requests to the reference plugin', async () => {
    const fetcher = vi.fn();
    const host = createHost({ location: { ...location, pathname: '/plugin/neko_survivors/ui/index.html' }, fetch: fetcher });
    expect(host.mode).toBe('standalone');
    expect(await host.report('wave', 'text')).toMatchObject({ status: 'unavailable' });
    expect(fetcher).not.toHaveBeenCalled(); host.dispose();
  });
  it('discards late results after disposal and sends a formal close independently of abort', async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementation((url: URL) => url.pathname === '/security/csrf-token'
      ? Promise.resolve(Response.json({ csrf_token: 'host-test-token' })) : url.pathname.endsWith('/speak')
      ? new Promise<Response>(done => { resolve = done; }) : Promise.resolve(reply('completed')));
    const host = createHost({ location, fetch: fetcher });
    await host.resetSession();
    const result = host.speak('line');
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    host.dispose();
    resolve(reply('queued'));
    expect(await result).toMatchObject({ status: 'cancelled' });
    await vi.waitFor(() => expect(fetcher.mock.calls.some(call => String(call[0]).endsWith('/close_session'))).toBe(true));
  });
  it('reports server rejection honestly', async () => {
    const host = createHost({ location, fetch: vi.fn().mockImplementation((url: URL) => Promise.resolve(url.pathname === '/security/csrf-token'
      ? Response.json({ csrf_token: 'host-test-token' }) : new Response('', { status: 403 }))) });
    expect(await host.resetSession()).toMatchObject({ status: 'rejected' });
    expect(await host.speak('line')).toMatchObject({ status: 'rejected' });
    host.dispose();
  });
});
