import { describe, it, expect } from 'vitest';
import { searchMemories } from './db.js';

describe('searchMemories', () => {
    it('should return empty array for empty string', () => {
        const result = searchMemories('');
        expect(result).toEqual([]);
    });

    it('should return empty array and not throw for punctuation-only queries', () => {
        // These queries would previously cause SQLite FTS5 syntax errors
        expect(() => searchMemories('""')).not.toThrow();
        expect(searchMemories('""')).toEqual([]);

        expect(() => searchMemories('-')).not.toThrow();
        expect(searchMemories('-')).toEqual([]);

        expect(() => searchMemories('*')).not.toThrow();
        expect(searchMemories('*')).toEqual([]);

        expect(() => searchMemories('NOT')).not.toThrow();
        // 'NOT' contains alphanumeric characters, so the query will execute.
        // It shouldn't throw, and it will likely return [] if no memory matches.
    });
});
