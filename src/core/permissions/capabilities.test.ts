





import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    evaluateCapability,
    capabilitySatisfiedByBits,
} from '#core/permissions/capabilities.js';
import {
    getCapabilityDefinition,
    listCapabilityDefinitions,
} from '#core/types/capabilities.js';
import type { ResolvedPermissions } from '#core/types/permissions.js';

function resolved(bits: string[], botOwner = false): ResolvedPermissions {
    return {
        botOwner,
        bits: new Set(bits),
        resolvedAt: Math.floor(Date.now() / 1000),
    };
}

describe('capability definitions', () => {
    it('has no implicit inheritance member.view ⇏ member.ban', () => {
        const view = getCapabilityDefinition('member.view');
        const ban = getCapabilityDefinition('member.ban');
        assert.ok(view);
        assert.ok(ban);
        assert.notDeepEqual(view.requiredBits, ban.requiredBits);
        const actor = {
            userId: 'u1',
            isEnvOwner: false,
            resolved: resolved(['server.members.view']),
        };
        const viewOk = evaluateCapability({ actor, capabilityId: 'member.view' });
        const banOk = evaluateCapability({ actor, capabilityId: 'member.ban' });
        assert.equal(viewOk.allowed, true);
        assert.equal(banOk.allowed, false);
    });

    it('fleet.view does not imply fleet.worker.restart', () => {
        const actor = {
            userId: 'u1',
            isEnvOwner: false,
            resolved: resolved(['bot.fleet.view']),
        };
        assert.equal(evaluateCapability({ actor, capabilityId: 'fleet.view' }).allowed, true);
        assert.equal(evaluateCapability({ actor, capabilityId: 'fleet.worker.restart' }).allowed, false);
    });

    it('bot.owner satisfies capabilities via bitsSatisfy', () => {
        const actor = {
            userId: 'owner',
            isEnvOwner: true,
            resolved: resolved(['bot.owner'], true),
        };
        assert.equal(evaluateCapability({ actor, capabilityId: 'member.ban' }).allowed, true);
        assert.equal(evaluateCapability({ actor, capabilityId: 'fleet.restart' }).allowed, true);
    });

    it('unknown capability id is not satisfied by bits', () => {
        assert.equal(capabilitySatisfiedByBits('not.a.real.capability', resolved(['bot.owner'], true)), false);
    });

    it('member.ban without target resolution fails hierarchy path', () => {
        const actor = {
            userId: 'mod',
            isEnvOwner: false,
            resolved: resolved(['server.members.ban']),
        };
        const d = evaluateCapability({
            actor,
            capabilityId: 'member.ban',
            target: { kind: 'member', id: 'target-1' },
        });
        assert.equal(d.allowed, false);
        assert.equal(d.code, 'RESOURCE_UNRESOLVED');
    });

    it('catalog is non-empty and ids are unique', () => {
        const all = listCapabilityDefinitions();
        assert.ok(all.length > 10);
        const ids = new Set(all.map((c) => c.id));
        assert.equal(ids.size, all.length);
    });
});

describe('hierarchy requirement flags', () => {
    it('member.ban requires target hierarchy', () => {
        const def = getCapabilityDefinition('member.ban');
        assert.equal(def?.requiresTargetHierarchy, true);
        assert.equal(def?.targetType, 'member');
    });

    it('plugin.view does not require target hierarchy', () => {
        const def = getCapabilityDefinition('plugin.view');
        assert.equal(def?.requiresTargetHierarchy, false);
    });
});
