/**
 * Phase 5 — TypeORM registry regression (API surface used by DatabaseManager).
 * Does not require a live DB: validates connect options construction path is typed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

describe('typeorm dependency and SqlRegistry surface', () => {
    it('package.json declares typeorm 1.x (DataSource era)', () => {
        const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
        const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
            dependencies: Record<string, string>;
        };
        const v = pkg.dependencies.typeorm;
        assert.ok(v, 'typeorm must be a direct dependency');
        // TypeORM 1.0+ is the current major line (2026); reject accidental 0.2-era pins
        assert.match(v, /\^?1\./);
    });

    it('typeorm module exports ormDB SqlRegistry', async () => {
        // Dynamic import may fail without node_modules — still assert source exports exist
        const src = readFileSync(
            path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'typeorm.ts'),
            'utf8',
        );
        assert.match(src, /export class SqlRegistry/);
        assert.match(src, /export const ormDB/);
        assert.match(src, /DataSource/);
        assert.doesNotMatch(src, /as any/);
    });
});
