import type { Candidate } from './matcher';
import styles from './popup.css?inline';

export type Theme = 'light' | 'dark';

/** 入力欄とポップアップの間隔(px) */
const GAP = 6;
const MIN_WIDTH = 240;
const VIEWPORT_MARGIN = 8;

/**
 * 候補ポップアップ。Twitch の CSS と相互に影響しないよう Shadow DOM 内に描画する。
 * ホスト要素は document.body 直下に position: fixed で置き、入力欄の真上に配置する。
 */
export class SuggestionPopup {
  private readonly host: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly list: HTMLUListElement;
  private candidates: Candidate[] = [];
  private activeIndex = 0;
  private anchor: HTMLElement | null = null;

  constructor(private readonly onPick: (candidate: Candidate) => void) {
    this.host = document.createElement('chatfixedtext-popup');
    const shadow = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = styles;

    this.panel = document.createElement('div');
    this.panel.className = 'panel';
    this.list = document.createElement('ul');
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', '定型文の候補');

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.innerHTML = '<kbd>↑↓</kbd> 選択 ・ <kbd>Tab</kbd>/<kbd>Enter</kbd> 確定 ・ <kbd>Esc</kbd> 閉じる';

    this.panel.append(this.list, hint);
    shadow.append(style, this.panel);

    // mousedown で入力欄からフォーカスが外れないようにする
    this.panel.addEventListener('mousedown', (event) => event.preventDefault());
    this.list.addEventListener('click', (event) => {
      const index = this.indexFromEvent(event);
      if (index !== null) this.onPick(this.candidates[index]);
    });
    this.list.addEventListener('mousemove', (event) => {
      const index = this.indexFromEvent(event);
      if (index !== null && index !== this.activeIndex) this.setActive(index);
    });
  }

  get isOpen(): boolean {
    return this.host.hasAttribute('data-open');
  }

  get active(): Candidate | null {
    return this.candidates[this.activeIndex] ?? null;
  }

  show(candidates: Candidate[], anchor: HTMLElement, theme: Theme): void {
    if (candidates.length === 0) {
      this.hide();
      return;
    }
    const previous = this.active?.phrase.id;
    this.candidates = candidates;
    this.anchor = anchor;
    // 候補が更新されても、同じ定型文が残っていれば選択を維持する
    const kept = candidates.findIndex((c) => c.phrase.id === previous);
    this.activeIndex = kept >= 0 ? kept : 0;

    this.render();
    this.host.dataset.theme = theme;
    if (!this.host.isConnected) document.body.append(this.host);
    this.host.setAttribute('data-open', '');
    this.reposition();
  }

  hide(): void {
    this.host.removeAttribute('data-open');
    this.candidates = [];
    this.anchor = null;
  }

  /** 選択を delta だけ移動する（端で反対側に回り込む） */
  move(delta: number): void {
    const count = this.candidates.length;
    if (count === 0) return;
    this.setActive((this.activeIndex + delta + count) % count);
  }

  /** 入力欄の真上に配置する。上に収まらない場合は高さを詰めてスクロールさせる */
  reposition(): void {
    if (!this.isOpen || !this.anchor) return;
    if (!this.anchor.isConnected) {
      this.hide();
      return;
    }
    const rect = this.anchor.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const width = Math.min(Math.max(rect.width, MIN_WIDTH), viewportWidth - VIEWPORT_MARGIN * 2);
    const left = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), viewportWidth - width - VIEWPORT_MARGIN);

    Object.assign(this.host.style, {
      left: `${left}px`,
      bottom: `${window.innerHeight - rect.top + GAP}px`,
      width: `${width}px`,
    });
    this.panel.style.maxHeight = `${Math.max(rect.top - GAP - VIEWPORT_MARGIN, 80)}px`;
  }

  destroy(): void {
    this.host.remove();
  }

  private render(): void {
    const items = this.candidates.map((candidate, index) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.index = String(index);

      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = candidate.phrase.text;
      li.append(text);

      if (candidate.matchedKeyword !== null) {
        const keyword = document.createElement('span');
        keyword.className = 'keyword';
        keyword.textContent = candidate.matchedKeyword;
        li.append(keyword);
      }
      return li;
    });
    this.list.replaceChildren(...items);
    this.setActive(this.activeIndex);
  }

  private setActive(index: number): void {
    this.activeIndex = index;
    this.list.querySelectorAll('li').forEach((li, i) => {
      li.setAttribute('aria-selected', String(i === index));
    });
    this.list.children[index]?.scrollIntoView({ block: 'nearest' });
  }

  private indexFromEvent(event: Event): number | null {
    const li = (event.target as Element | null)?.closest('li');
    if (!li || li.dataset.index === undefined) return null;
    return Number(li.dataset.index);
  }
}
