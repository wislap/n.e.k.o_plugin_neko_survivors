import type { HostResult, HostStatus } from './neko-host';

export type SdkOperation = 'runtime' | 'dialogue' | 'speech-output';
export interface SdkReceipt extends HostResult { readonly line?: string }
export type DialogueReceipt = { readonly status: 'submitted'; readonly line: string } | { readonly status: Exclude<HostStatus, 'submitted'>; readonly reason?: string };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Decode only the documented SDK response and the operation's actual wire fields. */
export function decodeSdkReceipt(value: unknown, operation: 'dialogue'): DialogueReceipt;
export function decodeSdkReceipt(value: unknown, operation: 'runtime' | 'speech-output'): HostResult;
export function decodeSdkReceipt(value: unknown, operation: SdkOperation): SdkReceipt;
export function decodeSdkReceipt(value: unknown, operation: SdkOperation): SdkReceipt {
  if (!object(value) || value.ok !== true || !object(value.data)) return { status: 'rejected', reason: 'sdk_request_rejected' };
  const payload = value.data;
  for (const key of ['reason', 'error', 'line']) if (payload[key] !== undefined && typeof payload[key] !== 'string') return { status: 'rejected', reason: 'invalid_sdk_receipt' };
  for (const key of ['ok', 'handled', 'audio_sent']) if (payload[key] !== undefined && typeof payload[key] !== 'boolean') return { status: 'rejected', reason: 'invalid_sdk_receipt' };
  if (payload.skipped !== undefined && typeof payload.skipped !== 'boolean' && typeof payload.skipped !== 'string') return { status: 'rejected', reason: 'invalid_sdk_receipt' };
  const reason = typeof payload.reason === 'string' ? payload.reason : undefined;
  if (payload.ok === false || payload.error) return { status: 'rejected', reason: typeof payload.error === 'string' ? payload.error : reason ?? 'sdk_request_rejected' };
  if (payload.skipped || payload.handled === false) return { status: 'cancelled', reason: reason ?? (typeof payload.skipped === 'string' ? payload.skipped : 'request_not_handled') };
  if (operation === 'speech-output' && payload.audio_sent === false) return { status: 'unavailable', reason: reason ?? 'speech_not_sent' };
  if (operation === 'dialogue') {
    if (typeof payload.line !== 'string' || !payload.line.trim()) return { status: 'rejected', reason: 'empty_dialogue_line' };
    return { status: 'submitted', line: payload.line.trim() };
  }
  return { status: 'submitted' };
}
