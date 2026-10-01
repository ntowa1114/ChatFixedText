import { describe, expect, it } from 'vitest';
import phrasesJson from '../src/data/phrases.json';
import { validatePhrases } from '../src/types';

describe('validatePhrases', () => {
  it('同梱の phrases.json はすべて有効', () => {
    const { phrases, errors } = validatePhrases(phrasesJson);
    expect(errors).toEqual([]);
    expect(phrases).toHaveLength(phrasesJson.length);
  });

  it('ルートが配列でなければエラー', () => {
    expect(validatePhrases({}).errors).toHaveLength(1);
  });

  it('不正な要素だけを除外してエラーを報告する', () => {
    const { phrases, errors } = validatePhrases([
      { id: 'ok', text: 'OK', keywords: ['ok'] },
      { id: 'ok', text: '重複', keywords: [] },
      { id: 'bad id', text: '', keywords: 'x' },
      { id: 'space', text: 'x', keywords: ['a b', ''] },
      { id: 'extra', text: 'x', keywords: [], note: 'x' },
      null,
    ]);
    expect(phrases.map((p) => p.id)).toEqual(['ok']);
    expect(errors.join('\n')).toMatch(/phrases\[1\]\.id: "ok" が重複/);
    expect(errors.join('\n')).toMatch(/phrases\[2\]\.id/);
    expect(errors.join('\n')).toMatch(/phrases\[2\]\.text/);
    expect(errors.join('\n')).toMatch(/phrases\[2\]\.keywords/);
    expect(errors.join('\n')).toMatch(/phrases\[3\]\.keywords\[0\]: 空白/);
    expect(errors.join('\n')).toMatch(/phrases\[3\]\.keywords\[1\]/);
    expect(errors.join('\n')).toMatch(/phrases\[4\]: 不明なプロパティ "note"/);
    expect(errors.join('\n')).toMatch(/phrases\[5\]: オブジェクト/);
  });
});
