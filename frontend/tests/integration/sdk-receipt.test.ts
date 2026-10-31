import { describe, expect, it } from 'vitest';
import { decodeSdkReceipt } from '../../src/host/sdk-receipt';
describe('documented SDK receipts', () => {
  it('returns a typed dialogue line and receipt-only speech acceptance', () => {
    expect(decodeSdkReceipt({ok:true,data:{line:'  Hello  '}},'dialogue')).toEqual({status:'submitted',line:'Hello'});
    expect(decodeSdkReceipt({ok:true,data:{audio_sent:true,line:'ignored'}},'speech-output')).toEqual({status:'submitted'});
  });
  it.each([null, [], {ok:true,data:[]}, {ok:true,data:{line:42}}, {ok:true,data:{handled:'false'}}, {ok:true,data:{skipped:{}}}])('rejects malformed wire fields %j', value => {
    expect(decodeSdkReceipt(value,'dialogue').status).toBe('rejected');
  });
  it('distinguishes provider rejection, cancellation and unavailable speech', () => {
    expect(decodeSdkReceipt({ok:true,data:{ok:false,reason:'provider'}},'dialogue')).toEqual({status:'rejected',reason:'provider'});
    expect(decodeSdkReceipt({ok:true,data:{handled:false,reason:'retired'}},'speech-output')).toEqual({status:'cancelled',reason:'retired'});
    expect(decodeSdkReceipt({ok:true,data:{audio_sent:false}},'speech-output')).toEqual({status:'unavailable',reason:'speech_not_sent'});
    expect(decodeSdkReceipt({ok:true,data:{}},'dialogue')).toEqual({status:'rejected',reason:'empty_dialogue_line'});
  });
});
