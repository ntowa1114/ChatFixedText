/**
 * デバッグログ。Twitch のページで DevTools コンソールから
 *   localStorage.setItem('chatfixedtext:debug', '1')
 * を実行してリロードすると有効になる（無効化は removeItem）。
 */
const STORAGE_KEY = 'chatfixedtext:debug';
const PREFIX = '[ChatFixedText]';

let enabled: boolean | null = null;

export function isDebugEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      enabled = false;
    }
  }
  return enabled;
}

export function debugLog(...args: unknown[]): void {
  if (isDebugEnabled()) console.log(PREFIX, ...args);
}

export function debugWarn(...args: unknown[]): void {
  if (isDebugEnabled()) console.warn(PREFIX, ...args);
}
