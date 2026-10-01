import type { Phrase } from '../types';

/** 候補の一致の種類。数値が小さいほど優先される。 */
export const MatchKind = {
  /** キーワード（または本文）と完全一致 */
  Exact: 0,
  /** 前方一致 */
  Prefix: 1,
  /** 部分一致 */
  Partial: 2,
} as const;
export type MatchKind = (typeof MatchKind)[keyof typeof MatchKind];

export interface Candidate {
  phrase: Phrase;
  kind: MatchKind;
  /** 一致したキーワード（本文で一致した場合は null） */
  matchedKeyword: string | null;
}

export interface MatcherOptions {
  /** 最大候補数 */
  limit?: number;
}

export const DEFAULT_LIMIT = 8;

const KATAKANA = /[ァ-ヶ]/g;

/**
 * 比較用に文字列を正規化する。
 * - NFKC（全角英数→半角、半角カナ→全角カナ）
 * - 小文字化
 * - カタカナ→ひらがな
 */
export function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(KATAKANA, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

interface IndexedPhrase {
  phrase: Phrase;
  order: number;
  text: string;
  keywords: { raw: string; normalized: string }[];
}

function classify(target: string, query: string): MatchKind | null {
  if (target === query) return MatchKind.Exact;
  if (target.startsWith(query)) return MatchKind.Prefix;
  if (target.includes(query)) return MatchKind.Partial;
  return null;
}

/**
 * 定型文リストから検索関数を作る。正規化済みの値を事前計算しておく。
 *
 * 優先順位: 完全一致 > 前方一致 > 部分一致。同順位は phrases.json の並び順。
 * 入力がすでに定型文の本文と同じ場合、その定型文は候補に出さない（確定済みとみなす）。
 */
export function createMatcher(phrases: readonly Phrase[], options: MatcherOptions = {}) {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const index: IndexedPhrase[] = phrases.map((phrase, order) => ({
    phrase,
    order,
    text: normalize(phrase.text),
    keywords: phrase.keywords.map((raw) => ({ raw, normalized: normalize(raw) })),
  }));

  return function match(rawQuery: string): Candidate[] {
    const query = normalize(rawQuery.trim());
    if (query === '') return [];

    const hits: (Candidate & { order: number })[] = [];
    for (const entry of index) {
      if (entry.text === query) continue;

      let best: { kind: MatchKind; keyword: string | null } | null = null;
      for (const keyword of entry.keywords) {
        const kind = classify(keyword.normalized, query);
        if (kind !== null && (best === null || kind < best.kind)) {
          best = { kind, keyword: keyword.raw };
        }
      }
      const textKind = classify(entry.text, query);
      if (textKind !== null && (best === null || textKind < best.kind)) {
        best = { kind: textKind, keyword: null };
      }

      if (best !== null) {
        hits.push({ phrase: entry.phrase, kind: best.kind, matchedKeyword: best.keyword, order: entry.order });
      }
    }

    hits.sort((a, b) => a.kind - b.kind || a.order - b.order);
    return hits.slice(0, limit).map(({ phrase, kind, matchedKeyword }) => ({ phrase, kind, matchedKeyword }));
  };
}

export type Matcher = ReturnType<typeof createMatcher>;

/** 他の補完機能と衝突するため、候補を出さない入力の先頭文字 */
const RESERVED_INPUT_PREFIXES = [':', '/'];
/** 他の補完機能（エモート・メンション）と衝突するため、候補を出さない単語の先頭文字 */
const RESERVED_TOKEN_PREFIXES = [':', '@'];

/**
 * 入力欄全体のテキストとキャレット直前の単語から、候補検索に使うクエリを決める。
 * 候補を出すべきでない場合は null を返す。
 *
 * @param fullText 入力欄全体のテキスト
 * @param token キャレット直前の、空白を含まない文字列
 * @param minLength クエリの最小文字数
 */
export function resolveQuery(fullText: string, token: string, minLength: number): string | null {
  const trimmed = fullText.trimStart();
  if (RESERVED_INPUT_PREFIXES.some((p) => trimmed.startsWith(p))) return null;
  if (RESERVED_TOKEN_PREFIXES.some((p) => token.startsWith(p))) return null;
  if ([...token].length < minLength) return null;
  return token;
}
