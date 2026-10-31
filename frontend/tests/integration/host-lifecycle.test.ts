import { describe, expect, it, vi } from 'vitest';
import { createConnectedHost, createHost, type MiniGameClient, type SdkBootstrap } from '../../src/host';
const location = { origin: 'http://localhost:48916', pathname: '/plugin/neko_survivors_react/ui/index.html' };
const reply = (data: Record<string, unknown>) => new Response(JSON.stringify({ result: data }));
function transport() {
  const requests: { action: string; args: Record<string, string> }[] = [];
  const fetcher = vi.fn().mockImplementation((url: URL, options: RequestInit) => {
    if (url.pathname === '/security/csrf-token') return Promise.resolve(Response.json({ csrf_token: 'host-test-token' }));
    const action = url.pathname.split('/').at(-1)!;
    const args = JSON.parse(String(options.body)).args as Record<string, string>;
    requests.push({ action, args });
    return Promise.resolve(reply({ status: action === 'speak' ? 'queued' : 'completed' }));
  });
  return { requests, fetcher };
}

describe('formal plugin session generations', () => {
  it('closes each previous generation before opening a new one', async () => {
    const { requests, fetcher } = transport();
    const host = createHost({ location, fetch: fetcher });
    await host.resetSession(); await host.speak('first');
    await host.resetSession(); await host.speak('second');
    await host.closeSession(); host.dispose();
    expect(requests.map(request => request.action)).toEqual(['open_session','speak','close_session','open_session','speak','close_session']);
    expect(requests[0]?.args.session_id).not.toBe(requests[3]?.args.session_id);
    expect(requests[0]?.args.route_id).not.toBe(requests[3]?.args.route_id);
    expect(requests[1]?.args.session_id).toBe(requests[2]?.args.session_id);
    expect(requests[4]?.args.session_id).toBe(requests[5]?.args.session_id);
    expect(requests[1]?.args.correlation_id).not.toBe(requests[4]?.args.correlation_id);
  });
  it('does not open a replacement route until a failed old close is acknowledged', async () => {
    const { requests, fetcher } = transport();
    const base = fetcher.getMockImplementation()!;
    let unavailable = false;
    fetcher.mockImplementation((url: URL, options: RequestInit) => unavailable && url.pathname.endsWith('/close_session')
      ? Promise.resolve(new Response('', { status: 503 })) : base(url, options));
    const host = createHost({ location, fetch: fetcher });
    await host.resetSession(); unavailable = true;
    expect(await host.resetSession()).toMatchObject({ status: 'unavailable' });
    expect(requests.filter(request => request.action === 'open_session')).toHaveLength(1);
    unavailable = false; await host.resetSession();
    expect(requests.filter(request => request.action === 'open_session')).toHaveLength(2);
    await host.closeSession(); host.dispose();
  });
  it('reconnects after a late host startup and detects a desktop character change', async () => {
    vi.useFakeTimers();
    const { fetcher } = transport();
    const base = fetcher.getMockImplementation()!;
    let online = false, changed = false;
    fetcher.mockImplementation((url: URL, options: RequestInit) => {
      if (!online) return Promise.resolve(new Response('', { status: 503 }));
      if (changed && url.pathname.endsWith('/heartbeat_session')) { changed = false; return Promise.resolve(reply({ status:'unavailable', reason:'character_changed' })); }
      return base(url,options);
    });
    const host=createHost({location,fetch:fetcher});
    expect(await host.resetSession()).toMatchObject({status:'unavailable'});
    online=true;
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetcher.mock.calls.filter(call=>String(call[0]).endsWith('/open_session')).length).toBe(1);
    changed=true;
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetcher.mock.calls.filter(call=>String(call[0]).endsWith('/open_session')).length).toBe(2);
    await host.closeSession();host.dispose();vi.useRealTimers();
  });
  it('rejects malformed action envelopes instead of treating HTTP 200 as success', async () => {
    const host=createHost({location,fetch:vi.fn().mockImplementation((url: URL) => Promise.resolve(url.pathname === '/security/csrf-token'
      ? Response.json({ csrf_token: 'host-test-token' }) : new Response('[]')))});
    expect(await host.resetSession()).toMatchObject({status:'rejected',reason:'invalid_response'});
    host.dispose();
  });
});

function sdkClient() {
  let sequence = 0;
  const runtime = {
    state: 'running',
    session: { id:'sdk-0' },
    configure: vi.fn(), stopMonitoring:vi.fn(),
    reset: vi.fn(function(this:{session:{id:string}}){this.session={id:`sdk-${++sequence}`};}),
    start:vi.fn().mockResolvedValue({ok:true,data:{}}), end:vi.fn().mockResolvedValue({ok:true,data:{}}),
  };
  const client = {runtime,capabilities:{has:()=>true},dialogue:{request:vi.fn().mockResolvedValue({ok:true,data:{line:'line'}})},speech:{speak:vi.fn().mockResolvedValue({ok:true,data:{}})},avatar:{getCurrentCharacter:vi.fn().mockResolvedValue({name:'YUI',model:{type:'live2d',path:'/model.json'},rendererAvailable:true}),mount:vi.fn().mockResolvedValue({dispose:vi.fn()})},dispose:vi.fn()};
  return { raw:client,client:client as unknown as MiniGameClient };
}
describe('official SDK injection',()=>{
  it('uses the caller-provided connected client and retires runtime sessions',async()=>{
    const {raw,client}=sdkClient();const host=createHost({sdk:client,location:{origin:'https://game.example',pathname:'/game/'}});
    await host.resetSession();await host.speak('line');await host.resetSession();await host.closeSession();host.dispose();
    expect(raw.runtime.start).toHaveBeenCalledTimes(2);expect(raw.runtime.end).toHaveBeenCalledTimes(2);
    expect(raw.speech.speak).toHaveBeenCalledTimes(1);expect(raw.dispose).not.toHaveBeenCalled();
  });
  it('generates commentary once and sends exactly that line to SDK speech',async()=>{
    const {raw,client}=sdkClient();const host=createHost({sdk:client,location:{origin:'https://game.example',pathname:'/game/'}});
    await host.resetSession();
    expect(await host.report('boss_spawn','Boss arrives')).toMatchObject({status:'submitted'});
    expect(raw.dialogue.request).toHaveBeenCalledTimes(1);expect(raw.speech.speak).toHaveBeenCalledTimes(1);
    expect(raw.speech.speak.mock.calls[0]?.[0].text).toBe('line');
    expect(await host.report('boss_spawn','Again')).toMatchObject({status:'throttled'});
    await host.closeSession();host.dispose();
  });
  it('normalizes event identity before cooldown keys and speech output',async()=>{
    const clock=vi.spyOn(performance,'now').mockReturnValue(100_000);
    const {raw,client}=sdkClient();const host=createHost({sdk:client});
    try {
      await host.resetSession();
      const prefix='x'.repeat(40);
      expect(await host.report(' '+prefix+'first ','first')).toMatchObject({status:'submitted'});
      expect(raw.speech.speak.mock.calls[0]?.[0].eventKey).toBe(`survivors-react:${prefix}`);
      clock.mockReturnValue(114_000);
      expect(await host.report(prefix+'second','second')).toMatchObject({status:'throttled'});
      expect(raw.dialogue.request).toHaveBeenCalledTimes(1);
    } finally {await host.closeSession();host.dispose();clock.mockRestore();}
  });
  it('mounts only a trusted pre-registered SDK slot and disposes the typed lease',async()=>{
    const {raw,client}=sdkClient();
    const host=createHost({sdk:client,avatarSlot:'trusted-cat',location:{origin:'https://game.example',pathname:'/game/'}});
    const lease=await host.mountAvatar({ container: {} as HTMLElement });
    expect(raw.avatar.mount).toHaveBeenCalledWith(expect.objectContaining({slot:'trusted-cat',characterName:'YUI',model:{type:'live2d',path:'/model.json'}}));
    lease?.dispose();host.dispose();
    expect((await raw.avatar.mount.mock.results[0]?.value).dispose).toHaveBeenCalledTimes(1);
  });
  it('forwards emotion through the public SDK controller and retires cancelled/late receipts',async()=>{
    const {raw,client}=sdkClient();
    let finish!:(value: unknown)=>void;
    const setEmotion=vi.fn().mockResolvedValue(undefined), dispose=vi.fn();
    raw.avatar.mount.mockResolvedValue({setEmotion,dispose});
    const host=createHost({sdk:client,avatarSlot:'trusted-cat'});
    const lease=await host.mountAvatar({ container: {} as HTMLElement });
    expect(await lease?.setEmotion?.('happy')).toMatchObject({status:'completed'});
    expect(setEmotion).toHaveBeenCalledExactlyOnceWith('happy');
    const preAborted=new AbortController();preAborted.abort();
    expect(await lease?.setEmotion?.('sad',preAborted.signal)).toMatchObject({status:'cancelled'});
    expect(setEmotion).toHaveBeenCalledTimes(1);
    setEmotion.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
    const owner=new AbortController();const pending=lease!.setEmotion!('surprised',owner.signal);
    owner.abort();expect(await pending).toMatchObject({status:'cancelled'});
    finish(true);await Promise.resolve();
    lease?.dispose();
    expect(await lease?.setEmotion?.('happy')).toMatchObject({status:'cancelled'});
    expect(setEmotion).toHaveBeenCalledTimes(2);
    host.dispose();expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('returns unavailable instead of pretending a missing emotion controller applied an action',async()=>{
    const {client}=sdkClient();const host=createHost({sdk:client,avatarSlot:'trusted-cat'});
    const lease=await host.mountAvatar({ container: {} as HTMLElement });
    expect(await lease?.setEmotion?.('happy')).toMatchObject({status:'unavailable',reason:'emotion_not_available'});
    host.dispose();
  });
  it('does not invent a renderer slot, and cleans a mount that settles after cancellation',async()=>{
    const {raw,client}=sdkClient();
    const omitted=createHost({sdk:client,location:{origin:'https://game.example',pathname:'/game/'}});
    expect(await omitted.mountAvatar({ container: {} as HTMLElement })).toBeNull();expect(raw.avatar.mount).not.toHaveBeenCalled();omitted.dispose();
    let finish!:(controller:{dispose:()=>void})=>void;
    raw.avatar.mount.mockImplementation(()=>new Promise(done=>{finish=done;}));
    const host=createHost({sdk:client,avatarSlot:'trusted-cat',location:{origin:'https://game.example',pathname:'/game/'}});
    const abort=new AbortController();const mount=host.mountAvatar({ container: {} as HTMLElement, signal: abort.signal });
    await Promise.resolve();await Promise.resolve();
    abort.abort();await expect(mount).rejects.toMatchObject({name:'AbortError'});
    const dispose=vi.fn();finish({dispose});await Promise.resolve();expect(dispose).toHaveBeenCalledTimes(1);host.dispose();
  });
  it('connects only through a trusted supplied transport and disposes owned clients',async()=>{
    const {raw,client}=sdkClient();const connect=vi.fn().mockResolvedValue(client);const transport={connectGame:vi.fn()};
    const bootstrap={sdk:{connect},manifest:{id:'registered-game',version:'1.0.0',requiredCapabilities:['runtime','logging']},transport} as unknown as SdkBootstrap;
    const host=await createConnectedHost({sdkBootstrap:bootstrap});await host.resetSession();await host.closeSession();host.dispose();
    await Promise.resolve();await Promise.resolve();
    expect(connect.mock.calls[0]?.[1].transport).toBe(transport);expect(connect.mock.calls[0]?.[0]).toBe(bootstrap.manifest);
    expect(raw.runtime.configure).toHaveBeenCalled();expect(raw.dispose).toHaveBeenCalledTimes(1);
  });
  it('keeps gameplay standalone if the optional SDK handshake fails',async()=>{
    const bootstrap={sdk:{connect:vi.fn().mockRejectedValue(new Error('not_registered'))},manifest:{id:'unregistered'},transport:{}} as unknown as SdkBootstrap;
    const host=await createConnectedHost({sdkBootstrap:bootstrap});expect(host.mode).toBe('standalone');host.dispose();
  });
});
