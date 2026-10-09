import assert from 'node:assert/strict';
import type { DataRecord, DataStorageAdapter } from '../types.js';
import { canonicalizeSubject } from './recordCodec.js';

/**
 * Shared durable adapter contract. Callers supply a live adapter and unique type prefix.
 */
export async function runDataStorageAdapterContract(
    adapter: DataStorageAdapter,
    typePrefix: string,
): Promise<void> {
    const typeA = `${typePrefix}_a`;
    const typeB = `${typePrefix}_b`;
    const now = Date.now();

    const recUser: DataRecord = {
        typeId: typeA,
        key: 'k-user',
        subject: canonicalizeSubject({ userId: 'u1' }),
        value: { v: 1 },
        ownerPluginId: 'owner',
        updatedAt: now,
    };
    const recGuild: DataRecord = {
        typeId: typeA,
        key: 'k-guild',
        subject: canonicalizeSubject({ guildId: 'g1' }),
        value: { v: 2 },
        ownerPluginId: 'owner',
        updatedAt: now,
    };
    const recPlugin: DataRecord = {
        typeId: typeA,
        key: 'k-plugin',
        subject: canonicalizeSubject({ pluginId: 'plug1' }),
        value: { v: 3 },
        ownerPluginId: 'owner',
        updatedAt: now,
    };
    const recOtherType: DataRecord = {
        typeId: typeB,
        key: 'k-user',
        subject: canonicalizeSubject({ userId: 'u1' }),
        value: { other: true },
        ownerPluginId: 'owner',
        updatedAt: now,
    };

    await adapter.put(typeA, recUser.key, recUser);
    await adapter.put(typeA, recGuild.key, recGuild);
    await adapter.put(typeA, recPlugin.key, recPlugin);
    await adapter.put(typeB, recOtherType.key, recOtherType);

    const got = await adapter.get(typeA, 'k-user');
    assert.ok(got);
    assert.deepEqual(got.value, { v: 1 });
    assert.deepEqual(got.subject, { userId: 'u1' });
    assert.equal('guildId' in got.subject, false);

    // overwrite
    const updated: DataRecord = {
        ...recUser,
        value: { v: 99 },
        updatedAt: now + 1,
    };
    await adapter.put(typeA, 'k-user', updated);
    const got2 = await adapter.get(typeA, 'k-user');
    assert.deepEqual(got2?.value, { v: 99 });

    // type isolation
    const other = await adapter.get(typeB, 'k-user');
    assert.deepEqual(other?.value, { other: true });

    if (adapter.capabilities.structuredQuery) {
        const byUser = await adapter.query(typeA, { userId: 'u1' });
        assert.equal(byUser.length, 1);
        assert.equal(byUser[0]?.key, 'k-user');
    }

    if (adapter.capabilities.subjectDelete) {
        const n = await adapter.deleteBySubject(typeA, { guildId: 'g1' });
        assert.equal(n, 1);
        assert.equal(await adapter.get(typeA, 'k-guild'), undefined);
        assert.ok(await adapter.get(typeA, 'k-user'));
    }

    const deleted = await adapter.delete(typeA, 'k-plugin');
    assert.equal(deleted, true);
    assert.equal(await adapter.get(typeA, 'k-plugin'), undefined);

    // cleanup remaining
    await adapter.delete(typeA, 'k-user');
    await adapter.delete(typeB, 'k-user');
}
