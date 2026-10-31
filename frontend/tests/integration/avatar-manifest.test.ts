import { describe, expect, it, vi } from 'vitest';
import { createHost } from '../../src/host';
import { decodeAvatarManifest, decodeAvatarState } from '../../src/host/avatar/manifest';
const base = '/plugin/neko_survivors_react/ui/vendor/generation/';
const manifest = { name: 'YUI', generation: 'generation', modelUrl: `${base}model/cat.json`, scripts: [`${base}host.js`, `${base}engine.js`] };
describe('avatar wire contract', () => {
  it('accepts the identity-only polling contract without requiring model details', () => {
    expect(decodeAvatarState({ identity: 'cat' })).toEqual({ identity: 'cat' });
  });
  it('keeps the producer supplied engine order without a frontend script list', () => {
    expect(decodeAvatarManifest(manifest)).toEqual(manifest);
    expect(decodeAvatarManifest({ ...manifest, scripts: [...manifest.scripts].reverse() })?.scripts).toEqual([...manifest.scripts].reverse());
  });
  it.each([{}, { identity: '' }, { identity: '  ' }, { identity: 1, name: 'YUI', modelType: 'live2d' }])('rejects malformed identity %j', value => {
    expect(decodeAvatarState(value)).toBeNull();
  });
  it.each([{ scripts: [] }, { modelUrl: 'https://foreign.example/cat.json' }, { scripts: ['javascript:alert(1)'] }, { name: '' }])('rejects incomplete or nonlocal manifests %j', delta => {
    expect(decodeAvatarManifest({ ...manifest, ...delta })).toBeNull();
  });
  it.each([
    { status: 'completed', identity: 'cat', name: 'YUI', modelType: 'live2d' },
    { result: { success: true, data: { status: 'completed' } } },
    { result: { value: { status: 'completed' } } },
  ])('rejects non-contract action envelopes instead of guessing another payload path', async envelope => {
    const host = createHost({ location: { origin: 'https://host.example', pathname: '/plugin/neko_survivors_react/ui/index.html' },
      fetch: vi.fn(async (input: URL) => input.pathname === '/security/csrf-token' ? Response.json({ csrf_token: 'test' })
        : Response.json(envelope)) as unknown as typeof fetch });
    expect(await host.getAvatarState()).toEqual({ status: 'rejected', reason: 'invalid_response' });
    host.dispose();
  });
  it('rejects HTTP success whose business payload fails decoding', async () => {
    const host = createHost({ location: { origin: 'https://host.example', pathname: '/plugin/neko_survivors_react/ui/index.html' },
      fetch: vi.fn(async (input: URL) => input.pathname === '/security/csrf-token' ? Response.json({ csrf_token: 'test' })
        : Response.json({ result: { status: 'completed', identity: 1 } })) as unknown as typeof fetch });
    expect(await host.getAvatarState()).toEqual({ status: 'rejected', reason: 'invalid_avatar_state' });
    host.dispose();
  });
});


it('consumes a valid identity-only action payload through the plugin adapter', async () => {
  const host = createHost({ location: { origin: 'https://host.example', pathname: '/plugin/neko_survivors_react/ui/index.html' },
    fetch: vi.fn(async (input: URL) => input.pathname === '/security/csrf-token' ? Response.json({ csrf_token: 'test' })
      : Response.json({ result: { status: 'completed', identity: 'cat' } })) as unknown as typeof fetch });
  expect(await host.getAvatarState()).toEqual({ status: 'completed', data: { identity: 'cat' } }); host.dispose();
});
