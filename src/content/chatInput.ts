import { debugLog, debugWarn } from './debug';

/** Twitch のチャット入力欄（Slate.js の contenteditable） */
export const CHAT_INPUT_SELECTOR = '[data-a-target="chat-input"]';

/** Slate が空要素・void 要素の位置合わせに使うゼロ幅文字 */
const ZERO_WIDTH = '﻿';
const WHITESPACE = /\s/;

/**
 * ページ内のチャット入力欄を探す。
 * data-a-target 要素自体が contenteditable でない場合は、その内側の contenteditable を返す。
 * 複数ある場合はフォーカス中のもの、なければ表示されている最初のものを優先する。
 */
export function findChatInput(doc: Document = document): HTMLElement | null {
  const candidates: HTMLElement[] = [];
  for (const el of doc.querySelectorAll<HTMLElement>(CHAT_INPUT_SELECTOR)) {
    const editable = el.isContentEditable ? el : el.querySelector<HTMLElement>('[contenteditable="true"]');
    if (editable) candidates.push(editable);
  }
  const active = doc.activeElement;
  return (
    candidates.find((el) => active instanceof Node && el.contains(active)) ??
    candidates.find((el) => el.getClientRects().length > 0) ??
    candidates[0] ??
    null
  );
}

/**
 * フラット化したテキスト 1 文字分。DOM 上の位置を保持する。
 * char が null のものは void 要素（エモート画像など）や <br> で、単語の区切りとして扱う。
 */
interface Entry {
  char: string | null;
  node: Node;
  /** node がテキストノードのときの文字オフセット */
  offset: number;
}

/** 入力欄内のテキストを、DOM 位置付きの 1 文字ずつのリストに展開する */
function flatten(root: HTMLElement): Entry[] {
  const entries: Entry[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const data = (node as Text).data;
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== ZERO_WIDTH) entries.push({ char: data[i], node, offset: i });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if ((el !== root && el.getAttribute('contenteditable') === 'false') || el.tagName === 'BR') {
      entries.push({ char: null, node: el, offset: 0 });
      return;
    }
    for (const child of el.childNodes) visit(child);
  };
  visit(root);
  return entries;
}

function entriesToText(entries: readonly Entry[]): string {
  return entries.map((e) => e.char ?? ' ').join('');
}

const isWordChar = (entry: Entry | undefined): boolean =>
  entry !== undefined && entry.char !== null && !WHITESPACE.test(entry.char);

/** 入力欄全体のテキスト（ゼロ幅文字を除く。void 要素は空白 1 文字として数える） */
export function getInputText(root: HTMLElement): string {
  return entriesToText(flatten(root));
}

export interface TokenContext {
  /** 入力欄全体のテキスト */
  fullText: string;
  /** キャレット直前の単語（空白を含まない） */
  token: string;
  /** fullText 内での token の開始位置 */
  tokenStart: number;
  /** fullText 内でのキャレット位置 */
  caretIndex: number;
  /** token を覆う DOM Range */
  range: Range;
}

/**
 * キャレット直前の単語と、その DOM Range を取得する。
 * 選択範囲が入力欄外・範囲選択中・単語の途中にキャレットがある場合は null。
 */
export function getTokenContext(root: HTMLElement): TokenContext | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
  const caret = selection.getRangeAt(0);
  if (!root.contains(caret.startContainer)) return null;

  const entries = flatten(root);

  // 入力欄の先頭〜キャレットの Range に含まれる文字数 = キャレット位置
  const before = root.ownerDocument.createRange();
  before.setStart(root, 0);
  before.setEnd(caret.startContainer, caret.startOffset);
  let caretIndex = 0;
  while (caretIndex < entries.length) {
    const { node, offset } = entries[caretIndex];
    const isBefore = node === caret.startContainer ? offset < caret.startOffset : before.intersectsNode(node);
    if (!isBefore) break;
    caretIndex++;
  }

  // 単語の途中（キャレット直後が空白以外の文字）なら対象外
  if (isWordChar(entries[caretIndex])) return null;

  let tokenStart = caretIndex;
  while (tokenStart > 0 && isWordChar(entries[tokenStart - 1])) tokenStart--;
  if (tokenStart === caretIndex) return null;

  const first = entries[tokenStart];
  const range = root.ownerDocument.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(caret.startContainer, caret.startOffset);

  const fullText = entriesToText(entries);
  return {
    fullText,
    token: fullText.slice(tokenStart, caretIndex),
    tokenStart,
    caretIndex,
    range,
  };
}

// ---------------------------------------------------------------------------
// テキスト置換
// ---------------------------------------------------------------------------

/**
 * 置換方法。上から順に試す。
 *
 * - beforeinput: Slate (slate-react) は beforeinput の insertText を受けて自身の状態を更新し、
 *   preventDefault したうえで DOM を描画し直す。Slate に正しく反映される本命の方法。
 * - paste: Slate はプレーンテキストの paste を受けて insertData する。beforeinput が処理されなかった場合の予備。
 * - execCommand: ブラウザ標準の編集コマンド。Chrome では execCommand が beforeinput を発火しないため、
 *   Slate では DOM だけが変わり内部状態とずれる（＝送信内容に反映されない）。
 *   エディタが上記イベントを一切処理しなかった場合（Slate 以外の素の contenteditable）の最終手段。
 */
type Strategy = 'beforeinput' | 'paste' | 'execCommand';
const STRATEGIES: readonly Strategy[] = ['beforeinput', 'paste', 'execCommand'];

export interface ReplaceResult {
  ok: boolean;
  /** 置換に使った方法（何も効かなかった場合は null） */
  strategy: Strategy | null;
  before: string;
  expected: string;
  actual: string;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** DOM の選択範囲を変えたあと、Slate が selectionchange を処理して自身の選択範囲を同期するのを待つ */
function waitForSelectionSync(doc: Document): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      doc.removeEventListener('selectionchange', finish);
      // Slate 側の selectionchange ハンドラ（throttle あり）が走り終えるよう 2 フレーム待つ
      void nextFrame().then(nextFrame).then(resolve);
    };
    doc.addEventListener('selectionchange', finish);
    setTimeout(finish, 100);
  });
}

/** React / Slate の再描画が DOM に反映されるのを待つ */
async function settle(): Promise<void> {
  await nextFrame();
  await nextFrame();
}

function selectRange(range: Range): void {
  const selection = range.startContainer.ownerDocument!.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * 置換イベントを発火する。
 * @returns エディタがイベントを処理した（preventDefault した）か。execCommand はコマンドが実行されたか。
 */
function runStrategy(strategy: Strategy, root: HTMLElement, text: string): boolean {
  switch (strategy) {
    case 'beforeinput':
      return !root.dispatchEvent(
        new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true, composed: true }),
      );
    case 'paste': {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      return !root.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true, composed: true }),
      );
    }
    case 'execCommand':
      return root.ownerDocument.execCommand('insertText', false, text);
  }
}

/**
 * キャレット直前の単語を `text` に置き換える。
 *
 * innerText 等を直接書き換えると Slate / React の内部状態とずれて送信内容に反映されないため、
 * 「選択範囲を単語に合わせる → 編集イベントを発火」して Slate 自身に編集させる。
 * エディタがイベントを処理しなかった（＝入力欄が変化しなかった）場合だけ次の方法を試すので、二重挿入は起きない。
 * 実行後に入力欄のテキストを読み直して期待値と比較し、結果をデバッグログ（README 参照）に出力する。
 */
export async function replaceToken(root: HTMLElement, text: string): Promise<ReplaceResult> {
  const initial = getTokenContext(root);
  const before = getInputText(root);
  if (!initial) {
    debugWarn('置換対象の単語が見つかりません', { before });
    return { ok: false, strategy: null, before, expected: before, actual: before };
  }
  const expected =
    initial.fullText.slice(0, initial.tokenStart) + text + initial.fullText.slice(initial.caretIndex);

  root.focus();
  for (const strategy of STRATEGIES) {
    const context = getTokenContext(root);
    if (!context || context.token !== initial.token || getInputText(root) !== before) break;

    selectRange(context.range);
    await waitForSelectionSync(root.ownerDocument);
    const handled = runStrategy(strategy, root, text);
    await settle();

    const actual = getInputText(root);
    if (!handled && actual === before) {
      debugLog(`置換方法 "${strategy}" はエディタに処理されませんでした。次の方法を試します`);
      continue;
    }
    const result: ReplaceResult = { ok: actual === expected, strategy, before, expected, actual };
    if (result.ok) {
      debugLog('置換成功', result);
    } else {
      debugWarn('置換結果が期待値と一致しません', result);
    }
    if (strategy === 'execCommand') {
      debugWarn('execCommand で置換しました。Slate の内部状態に反映されず、送信内容が置換前のままになる可能性があります');
    }
    return result;
  }

  // 選択範囲を単語に合わせたままだと次の入力で単語が消えるので、キャレットを末尾に戻す
  root.ownerDocument.getSelection()?.collapseToEnd();
  const actual = getInputText(root);
  const result: ReplaceResult = { ok: false, strategy: null, before, expected, actual };
  debugWarn('置換に失敗しました', result);
  return result;
}
