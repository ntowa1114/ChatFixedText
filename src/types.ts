/** 定型文 1 件分のデータ。src/data/phrases.json の各要素。 */
export interface Phrase {
  /** 一意な ID（英数字・_・- のみ） */
  id: string;
  /** 入力欄に挿入される本文 */
  text: string;
  /** マッチングに使う読み・略称（例: "otu", "おつ"） */
  keywords: string[];
}

export interface PhraseValidationResult {
  /** 検証を通過した定型文 */
  phrases: Phrase[];
  /** 検証エラー（空なら全件 OK） */
  errors: string[];
}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * phrases.json の中身を検証する。
 * 不正な要素はエラーとして報告し、正しい要素だけを phrases に残す。
 * ビルド時（vite.config.ts）とロード時（content script）の両方で使う。
 */
export function validatePhrases(data: unknown): PhraseValidationResult {
  const errors: string[] = [];
  const phrases: Phrase[] = [];

  if (!Array.isArray(data)) {
    return { phrases, errors: ['phrases.json のルートは配列である必要があります'] };
  }

  const seenIds = new Set<string>();

  data.forEach((item, index) => {
    const at = `phrases[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${at}: オブジェクトである必要があります`);
      return;
    }

    const itemErrors: string[] = [];
    const { id, text, keywords } = item;

    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      itemErrors.push(`${at}.id: 英数字・"_"・"-" からなる空でない文字列である必要があります`);
    } else if (seenIds.has(id)) {
      itemErrors.push(`${at}.id: "${id}" が重複しています`);
    }

    if (typeof text !== 'string' || text.trim() === '') {
      itemErrors.push(`${at}.text: 空でない文字列である必要があります`);
    }

    if (!Array.isArray(keywords)) {
      itemErrors.push(`${at}.keywords: 文字列の配列である必要があります`);
    } else {
      keywords.forEach((keyword, k) => {
        if (typeof keyword !== 'string' || keyword.trim() === '') {
          itemErrors.push(`${at}.keywords[${k}]: 空でない文字列である必要があります`);
        } else if (/\s/.test(keyword)) {
          // 候補検索は空白区切りの「単語」単位で行うため、空白入りのキーワードはマッチしない
          itemErrors.push(`${at}.keywords[${k}]: 空白を含めることはできません`);
        }
      });
    }

    const extraKeys = Object.keys(item).filter((key) => !['id', 'text', 'keywords'].includes(key));
    if (extraKeys.length > 0) {
      itemErrors.push(`${at}: 不明なプロパティ ${extraKeys.map((k) => `"${k}"`).join(', ')}`);
    }

    if (itemErrors.length > 0) {
      errors.push(...itemErrors);
      return;
    }

    seenIds.add(id as string);
    phrases.push({ id: id as string, text: text as string, keywords: [...(keywords as string[])] });
  });

  return { phrases, errors };
}
