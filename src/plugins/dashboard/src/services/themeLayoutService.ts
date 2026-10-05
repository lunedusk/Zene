




import type { DashLayoutDoc, LayoutScope } from '../../../dash-data/src/lib/store.js';
import { layoutThemeRepository } from '../../../dash-data/src/repositories/layoutThemeRepository.js';
import type { RequestContext } from '../lib/requestContext.js';
import { ServiceError, serviceOk, type ServiceResult } from '../lib/requestContext.js';
import { assertCapability } from '../lib/resourceAuthz.js';
import { writeAudit } from '../lib/db.js';
import type { IHeart } from '#core/heart/index.js';

export interface PutThemeInput {
    tokens: Record<string, unknown>;
    expectedVersion?: number;
}

export interface PutLayoutInput {
    scope: LayoutScope;
    guildId?: string;
    doc: DashLayoutDoc;
    expectedVersion?: number;
}

export class ThemeLayoutService {
    constructor(private readonly heart: IHeart) {}

    async getTheme(ctx: RequestContext): Promise<ServiceResult<{ tokens: Record<string, unknown>; version: number }>> {
        await assertCapability(ctx, 'dashboard.theme.manage');
        const theme = await layoutThemeRepository.getTheme();
        return serviceOk(
            { tokens: theme.tokens, version: theme.version },
            { requestId: ctx.requestId },
        );
    }






    async getThemePublicAuthed(
        ctx: RequestContext,
    ): Promise<ServiceResult<{ tokens: Record<string, unknown>; version: number }>> {

        await assertCapability(ctx, 'dashboard.theme.manage');
        const theme = await layoutThemeRepository.getTheme();
        return serviceOk(
            { tokens: theme.tokens, version: theme.version },
            { requestId: ctx.requestId },
        );
    }

    async putTheme(ctx: RequestContext, input: PutThemeInput): Promise<ServiceResult<{ version: number }>> {
        await assertCapability(ctx, 'dashboard.theme.manage');
        if (!input.tokens || typeof input.tokens !== 'object' || Array.isArray(input.tokens)) {
            throw new ServiceError('VALIDATION', 'tokens must be an object', 400);
        }
        if (input.expectedVersion !== undefined) {
            const current = await layoutThemeRepository.getTheme();
            if (current.version !== input.expectedVersion) {
                throw new ServiceError('VERSION_CONFLICT', 'Theme version conflict', 409, {
                    expectedVersion: input.expectedVersion,
                    currentVersion: current.version,
                });
            }
        }
        const saved = await layoutThemeRepository.putTheme(input.tokens);
        await writeAudit(this.heart, {
            actorId: ctx.actor.userId,
            action: 'theme.put',
            target: 'theme',
            meta: { requestId: ctx.requestId, version: saved.version },
        });
        return serviceOk({ version: saved.version }, { requestId: ctx.requestId });
    }

    async getLayout(
        ctx: RequestContext,
        scope: LayoutScope,
        guildId?: string,
    ): Promise<ServiceResult<DashLayoutDoc | null>> {
        await assertCapability(ctx, 'dashboard.pages.manage');
        if (guildId) {
            const tokenGuild = ctx.session.payload.guildId;
            if (tokenGuild && tokenGuild !== guildId) {
                throw new ServiceError('FORBIDDEN', 'Session guild scope mismatch', 403);
            }
        }
        const doc = await layoutThemeRepository.getLayout(scope, guildId);
        return serviceOk(doc, { requestId: ctx.requestId });
    }

    async putLayout(ctx: RequestContext, input: PutLayoutInput): Promise<ServiceResult<{ saved: true }>> {
        await assertCapability(ctx, 'dashboard.pages.manage');
        if (input.guildId) {
            const tokenGuild = ctx.session.payload.guildId;
            if (tokenGuild && tokenGuild !== input.guildId) {
                throw new ServiceError('FORBIDDEN', 'Session guild scope mismatch', 403);
            }
        }
        if (input.expectedVersion !== undefined && input.doc.updatedAt !== undefined) {
            const current = await layoutThemeRepository.getLayout(input.scope, input.guildId);
            if (current && current.updatedAt !== input.expectedVersion) {
                throw new ServiceError('VERSION_CONFLICT', 'Layout version conflict', 409, {
                    expectedVersion: input.expectedVersion,
                    currentVersion: current.updatedAt,
                });
            }
        }
        await layoutThemeRepository.putLayout(input.doc);
        await writeAudit(this.heart, {
            actorId: ctx.actor.userId,
            action: 'layout.put',
            target: `${input.scope}:${input.guildId ?? 'global'}`,
            meta: { requestId: ctx.requestId },
        });
        return serviceOk({ saved: true }, { requestId: ctx.requestId });
    }
}
