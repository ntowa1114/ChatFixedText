import phrasesJson from '../data/phrases.json';
import { validatePhrases } from '../types';
import { findChatInput, getInputText, getTokenContext, replaceToken } from './chatInput';
import { debugLog } from './debug';
import { createMatcher, resolveQuery, type Candidate } from './matcher';
import { SuggestionPopup, type Theme } from './popup';

/** 候補を出し始める最小文字数（1 文字のときはキーワード完全一致のみ。matcher.ts の SHORT_QUERY_LENGTH 参照） */
const MIN_QUERY_LENGTH = 1;
/** 二重読み込み防止用のマーカー */
const LOADED_MARKER = 'chatfixedtextLoaded';

function detectTheme(): Theme {
  const root = document.documentElement.classList;
  if (root.contains('tw-root--theme-dark')) return 'dark';
  if (root.contains('tw-root--theme-light')) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** requestAnimationFrame で 1 フレームに 1 回へ間引く */
function rafThrottle(fn: () => void): () => void {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn();
    });
  };
}

class ChatFixedText {
  private readonly match = createMatcher(loadPhrases());
  private readonly popup = new SuggestionPopup((candidate) => void this.commit(candidate));

  /** 現在アタッチしている入力欄 */
  private input: HTMLElement | null = null;
  /** 入力欄の中身の変化を監視する（入力欄ごとに 1 つ） */
  private inputObserver: MutationObserver | null = null;
  /** IME 変換中か */
  private composing = false;
  /** 置換処理中か */
  private committing = false;
  /** Esc や確定の直後、入力欄の内容が変わるまで候補を出さないためのテキスト */
  private suppressedText: string | null = null;

  private readonly scheduleUpdate = rafThrottle(() => this.update());
  private readonly scheduleAttach = rafThrottle(() => this.attach(findChatInput()));
  private readonly scheduleReposition = rafThrottle(() => this.popup.reposition());

  start(): void {
    // リスナーはすべてここで 1 回だけ登録する。入力欄が差し替わっても this.input を付け替えるだけなので多重登録にならない。
    // keydown は Twitch 側のハンドラより先に処理するため window の capture フェーズで拾う
    window.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('compositionstart', this.onCompositionStart, true);
    document.addEventListener('compositionend', this.onCompositionEnd, true);
    document.addEventListener('selectionchange', this.onSelectionChange);
    document.addEventListener('focusin', this.onFocusIn, true);
    document.addEventListener('focusout', this.onFocusOut, true);
    window.addEventListener('resize', this.scheduleReposition);
    window.addEventListener('scroll', this.scheduleReposition, true);

    // Twitch は SPA なので、チャンネル移動やチャット再描画で入力欄が差し替わる
    new MutationObserver(this.scheduleAttach).observe(document.body, { childList: true, subtree: true });
    this.attach(findChatInput());
  }

  private attach(input: HTMLElement | null): void {
    if (input === this.input) return;
    this.inputObserver?.disconnect();
    this.inputObserver = null;
    this.popup.hide();
    this.input = input;
    this.suppressedText = null;
    if (!input) {
      debugLog('チャット入力欄が見つかりません（待機中）');
      return;
    }
    // Slate は beforeinput を preventDefault して自前で DOM を更新することがあるため、
    // input イベントではなく DOM の変化を監視して候補を更新する
    this.inputObserver = new MutationObserver(this.scheduleUpdate);
    this.inputObserver.observe(input, { childList: true, subtree: true, characterData: true });
    debugLog('チャット入力欄にアタッチしました', input);
  }

  private isInInput(target: EventTarget | null): boolean {
    return this.input !== null && target instanceof Node && this.input.contains(target);
  }

  private update(): void {
    const input = this.input;
    if (!input || this.composing || this.committing || !input.contains(document.activeElement)) {
      this.popup.hide();
      return;
    }

    const context = getTokenContext(input);
    if (this.suppressedText !== null) {
      if (getInputText(input) === this.suppressedText) {
        this.popup.hide();
        return;
      }
      this.suppressedText = null;
    }

    const query = context && resolveQuery(context.fullText, context.token, MIN_QUERY_LENGTH);
    if (!query) {
      this.popup.hide();
      return;
    }
    const anchor = input.closest<HTMLElement>('[data-a-target="chat-input"]') ?? input;
    this.popup.show(this.match(query), anchor, detectTheme());
  }

  private async commit(candidate: Candidate): Promise<void> {
    const input = this.input;
    if (!input || this.committing) return;
    this.popup.hide();
    this.committing = true;
    try {
      await replaceToken(input, candidate.phrase.text);
    } finally {
      this.committing = false;
      // 確定した結果に対して再び候補を出さない
      this.suppressedText = getInputText(input);
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isInInput(event.target)) return;

    if (!this.popup.isOpen) {
      // ポップアップ非表示時は一切干渉しない（デバッグ時のみ送信内容をログに出す）
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && this.input) {
        debugLog('Enter: 送信される入力欄の内容 =', JSON.stringify(getInputText(this.input)));
      }
      return;
    }

    // IME 変換中の Enter（変換確定）や矢印キーは IME に任せる
    if (event.isComposing || event.keyCode === 229 || this.composing) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    switch (event.key) {
      case 'ArrowUp':
        this.popup.move(-1);
        break;
      case 'ArrowDown':
        this.popup.move(1);
        break;
      case 'Tab':
      case 'Enter': {
        const candidate = this.popup.active;
        if (!candidate) return;
        void this.commit(candidate);
        break;
      }
      case 'Escape':
        this.suppressedText = this.input ? getInputText(this.input) : null;
        this.popup.hide();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  private readonly onCompositionStart = (event: CompositionEvent): void => {
    if (!this.isInInput(event.target)) return;
    this.composing = true;
    this.popup.hide();
  };

  private readonly onCompositionEnd = (event: CompositionEvent): void => {
    if (!this.isInInput(event.target)) return;
    this.composing = false;
    // 変換確定後の文字列でマッチングする
    this.scheduleUpdate();
  };

  private readonly onSelectionChange = (): void => {
    if (this.input?.contains(document.activeElement)) this.scheduleUpdate();
  };

  private readonly onFocusIn = (event: FocusEvent): void => {
    if (this.isInInput(event.target)) {
      this.scheduleUpdate();
    } else if (event.target instanceof Element && event.target.closest('[data-a-target="chat-input"]')) {
      // まだ認識していない入力欄にフォーカスが来た（再描画直後など）
      this.attach(findChatInput());
      this.scheduleUpdate();
    }
  };

  private readonly onFocusOut = (event: FocusEvent): void => {
    if (this.isInInput(event.target)) this.popup.hide();
  };
}

function loadPhrases() {
  const { phrases, errors } = validatePhrases(phrasesJson);
  if (errors.length > 0) {
    console.error('[ChatFixedText] phrases.json に不正なデータがあります（該当する定型文は無視します）:', errors);
  }
  debugLog(`定型文 ${phrases.length} 件を読み込みました`);
  return phrases;
}

if (!document.documentElement.dataset[LOADED_MARKER]) {
  document.documentElement.dataset[LOADED_MARKER] = 'true';
  new ChatFixedText().start();
}
