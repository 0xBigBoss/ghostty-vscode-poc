import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createFileCache,
  isAbsolutePath,
  stripGitDiffPrefix,
  resolvePath,
  quoteShellPath
} from './file-cache';

describe('file-cache', () => {
  describe('createFileCache', () => {
    it('returns undefined for non-existent entries', () => {
      const cache = createFileCache();
      expect(cache.get('/path/to/file.ts')).toBeUndefined();
    });

    it('returns cached value for existing entries', () => {
      const cache = createFileCache();
      cache.set('/path/to/file.ts', true);
      expect(cache.get('/path/to/file.ts')).toBe(true);
    });

    it('returns false when file does not exist', () => {
      const cache = createFileCache();
      cache.set('/nonexistent.ts', false);
      expect(cache.get('/nonexistent.ts')).toBe(false);
    });

    it('expires entries after TTL', async () => {
      const cache = createFileCache(50); // 50ms TTL
      cache.set('/path/to/file.ts', true);
      expect(cache.get('/path/to/file.ts')).toBe(true);

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 60));
      expect(cache.get('/path/to/file.ts')).toBeUndefined();
    });

    it('evicts oldest entry when at capacity', () => {
      const cache = createFileCache(5000, 3); // Max 3 entries
      cache.set('/file1.ts', true);
      cache.set('/file2.ts', true);
      cache.set('/file3.ts', true);

      // All three should exist
      expect(cache.size()).toBe(3);

      // Add fourth - should evict first
      cache.set('/file4.ts', true);
      expect(cache.size()).toBe(3);
      expect(cache.get('/file1.ts')).toBeUndefined(); // Evicted
      expect(cache.get('/file4.ts')).toBe(true); // Added
    });

    it('clear removes all entries', () => {
      const cache = createFileCache();
      cache.set('/file1.ts', true);
      cache.set('/file2.ts', true);
      expect(cache.size()).toBe(2);

      cache.clear();
      expect(cache.size()).toBe(0);
    });
  });

  describe('isAbsolutePath', () => {
    it('returns true for Unix absolute paths', () => {
      expect(isAbsolutePath('/home/user/file.ts')).toBe(true);
      expect(isAbsolutePath('/file.ts')).toBe(true);
    });

    it('returns true for Windows absolute paths', () => {
      expect(isAbsolutePath('C:/Users/file.ts')).toBe(true);
      expect(isAbsolutePath('D:\\Program Files\\app.exe')).toBe(true);
      expect(isAbsolutePath('c:/lowercase.txt')).toBe(true);
    });

    it('returns false for relative paths', () => {
      expect(isAbsolutePath('src/file.ts')).toBe(false);
      expect(isAbsolutePath('./file.ts')).toBe(false);
      expect(isAbsolutePath('../parent/file.ts')).toBe(false);
      expect(isAbsolutePath('file.ts')).toBe(false);
    });
  });

  describe('stripGitDiffPrefix', () => {
    it('strips a/ prefix', () => {
      expect(stripGitDiffPrefix('a/src/file.ts')).toBe('src/file.ts');
    });

    it('strips b/ prefix', () => {
      expect(stripGitDiffPrefix('b/src/file.ts')).toBe('src/file.ts');
    });

    it('leaves other paths unchanged', () => {
      expect(stripGitDiffPrefix('src/file.ts')).toBe('src/file.ts');
      expect(stripGitDiffPrefix('/absolute/file.ts')).toBe('/absolute/file.ts');
      expect(stripGitDiffPrefix('./relative.ts')).toBe('./relative.ts');
    });
  });

  describe('resolvePath', () => {
    it('returns absolute paths unchanged', () => {
      expect(resolvePath('/absolute/path.ts', '/cwd')).toBe('/absolute/path.ts');
      expect(resolvePath('C:/windows/path.ts', '/cwd')).toBe('C:/windows/path.ts');
    });

    it('resolves relative paths against CWD', () => {
      expect(resolvePath('src/file.ts', '/home/user/project')).toBe('/home/user/project/src/file.ts');
      expect(resolvePath('./file.ts', '/home/user')).toBe('/home/user/./file.ts');
    });

    it('strips git diff prefix before resolving', () => {
      expect(resolvePath('a/src/file.ts', '/project')).toBe('/project/src/file.ts');
      expect(resolvePath('b/src/file.ts', '/project')).toBe('/project/src/file.ts');
    });

    it('returns relative path when no CWD provided', () => {
      expect(resolvePath('src/file.ts')).toBe('src/file.ts');
    });
  });

  describe('quoteShellPath', () => {
    it('leaves simple paths unquoted', () => {
      expect(quoteShellPath('/home/user/file.ts')).toBe('/home/user/file.ts');
      expect(quoteShellPath('src/file.ts')).toBe('src/file.ts');
    });

    it('quotes paths with spaces', () => {
      expect(quoteShellPath('/path/with spaces/file.ts')).toBe("'/path/with spaces/file.ts'");
    });

    it('quotes paths with special characters', () => {
      expect(quoteShellPath('/path/$variable/file.ts')).toBe("'/path/$variable/file.ts'");
      expect(quoteShellPath('/path/with&ampersand.ts')).toBe("'/path/with&ampersand.ts'");
      expect(quoteShellPath('/path/(parens)/file.ts')).toBe("'/path/(parens)/file.ts'");
    });

    it('escapes single quotes within quoted paths', () => {
      expect(quoteShellPath("/path/it's/file.ts")).toBe("'/path/it'\\''s/file.ts'");
    });

    it('handles multiple special characters', () => {
      const complexPath = "/path/with spaces & symbols/file's name.ts";
      const quoted = quoteShellPath(complexPath);
      // Should be single-quoted with escaped internal quotes
      expect(quoted.startsWith("'")).toBe(true);
      expect(quoted.endsWith("'")).toBe(true);
    });
  });
});
