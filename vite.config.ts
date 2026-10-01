import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import { validatePhrases } from './src/types.ts';

const root = import.meta.dirname;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
}

/**
 * - ビルド開始時に src/data/phrases.json を検証し、不正ならビルドを失敗させる
 * - manifest.json に package.json の version を埋め込んで dist/ に出力する
 *   （バージョンは package.json だけで管理する）
 */
function extensionPlugin(): Plugin {
  return {
    name: 'chatfixedtext-extension',
    buildStart() {
      this.addWatchFile(resolve(root, 'src/data/phrases.json'));
      this.addWatchFile(resolve(root, 'manifest.json'));
      const { errors, phrases } = validatePhrases(readJson('src/data/phrases.json'));
      if (errors.length > 0) {
        this.error(`src/data/phrases.json が不正です:\n  - ${errors.join('\n  - ')}`);
      }
      this.info(`phrases.json: ${phrases.length} 件の定型文を検証しました`);
    },
    generateBundle() {
      const pkg = readJson('package.json') as { version: string };
      const manifest = readJson('manifest.json') as Record<string, unknown>;
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify({ ...manifest, version: pkg.version }, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [extensionPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome111',
    minify: false,
    // content script は ES Module として読み込めないので IIFE 1 ファイルにまとめる
    lib: {
      entry: resolve(root, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'ChatFixedText',
      fileName: () => 'content.js',
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
