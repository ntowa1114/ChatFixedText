import { describe, expect, it } from 'vitest';
import { createMatcher, MatchKind, normalize, resolveQuery } from '../src/content/matcher';
import type { Phrase } from '../src/types';

const phrases: Phrase[] = [
  { id: 'otsukare', text: 'お疲れ様です！', keywords: ['otu', 'otsukare', 'おつ'] },
  { id: 'clap', text: '8888888', keywords: ['88', 'pachi'] },
  { id: 'uow', text: 'うおw', keywords: ['uo', 'うお'] },
  { id: 'ehehe', text: 'えへへ', keywords: ['ehehe'] },
  { id: 'mata', text: 'お疲れ様でした！また来ます！', keywords: ['otumata', 'mata'] },
  { id: 'kotu', text: 'コツコツ', keywords: ['kotukotu'] },
  { id: 'gg', text: 'GG！', keywords: ['gg'] },
];

const ids = (results: { phrase: Phrase }[]) => results.map((r) => r.phrase.id);

describe('normalize', () => {
  it('全角英数を半角・小文字にする', () => {
    expect(normalize('ＯＴＵ８８')).toBe('otu88');
  });
  it('カタカナ（半角含む）をひらがなにする', () => {
    expect(normalize('ウオ')).toBe('うお');
    expect(normalize('ｳｵ')).toBe('うお');
  });
});

describe('createMatcher', () => {
  const match = createMatcher(phrases);

  it('キーワードの前方一致でヒットする', () => {
    expect(ids(match('otu'))[0]).toBe('otsukare');
    expect(match('otu')[0].matchedKeyword).toBe('otu');
  });

  it('"88" で 8888888 がヒットする', () => {
    expect(ids(match('88'))).toEqual(['clap']);
  });

  it('前方一致を部分一致より優先する', () => {
    // "otu": otsukare(完全一致) > mata(前方一致 otumata) > kotu(部分一致 kotukotu)
    const results = match('otu');
    expect(ids(results)).toEqual(['otsukare', 'mata', 'kotu']);
    expect(results.map((r) => r.kind)).toEqual([MatchKind.Exact, MatchKind.Prefix, MatchKind.Partial]);
  });

  it('同順位は phrases.json の並び順', () => {
    const match2 = createMatcher([
      { id: 'b', text: 'B', keywords: ['abc'] },
      { id: 'a', text: 'A', keywords: ['abd'] },
    ]);
    expect(ids(match2('ab'))).toEqual(['b', 'a']);
  });

  it('本文でもマッチする', () => {
    expect(ids(match('疲れ'))).toEqual(['otsukare', 'mata']);
    expect(match('疲れ')[0].matchedKeyword).toBeNull();
  });

  it('本文の前方一致はキーワードの部分一致より優先する', () => {
    const match2 = createMatcher([
      { id: 'partial', text: 'xyz', keywords: ['zzgo'] },
      { id: 'prefix', text: 'go!', keywords: ['hello'] },
    ]);
    expect(ids(match2('go'))).toEqual(['prefix', 'partial']);
  });

  it('大文字小文字・全角半角・カタカナひらがなを区別しない', () => {
    expect(ids(match('OTU'))[0]).toBe('otsukare');
    expect(ids(match('ｏｔｕ'))[0]).toBe('otsukare');
    expect(ids(match('ウオ'))).toEqual(['uow']);
    expect(ids(match('Gg'))).toEqual(['gg']);
  });

  it('入力が定型文の本文と同じなら、その定型文は候補に出さない', () => {
    expect(ids(match('8888888'))).toEqual([]);
    expect(ids(match('えへへ'))).toEqual([]);
  });

  it('一致しなければ空', () => {
    expect(match('zzz')).toEqual([]);
  });

  it('空文字・空白のみは空', () => {
    expect(match('')).toEqual([]);
    expect(match('   ')).toEqual([]);
  });

  it('最大件数で打ち切る（デフォルト 8 件）', () => {
    const many: Phrase[] = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, text: `text${i}`, keywords: [`key${i}`] }));
    expect(createMatcher(many)('key')).toHaveLength(8);
    expect(createMatcher(many, { limit: 3 })('key')).toHaveLength(3);
  });
});

describe('resolveQuery', () => {
  it('単語をそのままクエリにする', () => {
    expect(resolveQuery('otu', 'otu', 2)).toBe('otu');
    expect(resolveQuery('hello otu', 'otu', 2)).toBe('otu');
  });

  it('最小文字数未満なら null', () => {
    expect(resolveQuery('o', 'o', 2)).toBeNull();
    expect(resolveQuery('お', 'お', 2)).toBeNull();
    expect(resolveQuery('おつ', 'おつ', 2)).toBe('おつ');
  });

  it('入力が ":" や "/" で始まる場合は null（エモート・コマンド補完と衝突させない）', () => {
    expect(resolveQuery(':otu', ':otu', 2)).toBeNull();
    expect(resolveQuery('/me otu', 'otu', 2)).toBeNull();
    expect(resolveQuery('  /ban', '/ban', 2)).toBeNull();
  });

  it('単語が ":" や "@" で始まる場合は null', () => {
    expect(resolveQuery('hi :Kappa', ':Kappa', 2)).toBeNull();
    expect(resolveQuery('hi @otu', '@otu', 2)).toBeNull();
  });
});
