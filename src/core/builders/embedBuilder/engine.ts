import { EmbedLayout, BuildContext, BuildOptions, EmbedBuildResult, EmbedSpec } from "./types.js";
import { runBuild } from "./core.js";
import { interpolateVariables } from "#core/placeholder/index.js";
import { LIMITS } from "./constants.js";
import { assert } from "./errors.js";

export class EmbedBuilderEngine {
    private globalContext: BuildContext;
    private defaultOptions: BuildOptions;

    constructor(globalContext: BuildContext = {}, defaultOptions: BuildOptions = {}) {
        this.globalContext = globalContext;
        this.defaultOptions = defaultOptions;
    }

    public configure(context?: BuildContext, options?: BuildOptions) {
        if (context) {
            this.globalContext = {
                attachments: { ...this.globalContext.attachments, ...context.attachments },
                variables: { ...this.globalContext.variables, ...context.variables }
            };
        }
        if (options) this.defaultOptions = { ...this.defaultOptions, ...options };
    }

    private mergeContext(local?: BuildContext): BuildContext {
        return {
            assetManager: local?.assetManager || this.globalContext.assetManager,
            attachments: { ...this.globalContext.attachments, ...local?.attachments },
            variables: { ...this.globalContext.variables, ...local?.variables }
        };
    }

    public build(layout: EmbedLayout, localContext?: BuildContext, localOptions?: BuildOptions): EmbedBuildResult {
        const ctx = this.mergeContext(localContext);
        const spec = interpolateVariables(layout, ctx.variables);
        return runBuild(spec, ctx, { ...this.defaultOptions, ...localOptions });
    }

    public buildChunks(layout: EmbedLayout, localContext?: BuildContext, localOptions?: BuildOptions): EmbedBuildResult[] {
        const ctx = this.mergeContext(localContext);
        const opts = { ...this.defaultOptions, ...localOptions };
        const strict = opts.strict ?? false;

        const spec = interpolateVariables(layout, ctx.variables);
        assert(spec && Array.isArray(spec.embeds), "EmbedLayout.embeds must be an array");

        const chunks: EmbedBuildResult[] = [];
        let currentBatch: EmbedSpec[] = [];
        let currentWeight = 0;

        const expandedEmbeds: EmbedSpec[] = [];
        if (strict) {
            expandedEmbeds.push(...spec.embeds);
        } else {
            for (const emb of spec.embeds) {
                if (emb.fields && emb.fields.length > LIMITS.MAX_EMBED_FIELDS) {
                    const clonedFields = [...emb.fields];
                    expandedEmbeds.push({ ...emb, fields: clonedFields.splice(0, LIMITS.MAX_EMBED_FIELDS) });
                    while (clonedFields.length > 0) {
                        expandedEmbeds.push({ color: emb.color, fields: clonedFields.splice(0, LIMITS.MAX_EMBED_FIELDS) });
                    }
                } else {
                    expandedEmbeds.push(emb);
                }
            }
        }

        for (const emb of expandedEmbeds) {
            const weight = (emb.title?.length || 0) + 
                           (emb.description?.length || 0) + 
                           (emb.author?.name?.length || 0) + 
                           (emb.footer?.text?.length || 0) + 
                           (emb.fields?.reduce((acc, f) => acc + f.name.length + f.value.length, 0) || 0);

            if (currentBatch.length === LIMITS.MAX_EMBEDS_PER_MESSAGE || (currentWeight + weight) > LIMITS.MAX_TOTAL_EMBED_CHARS) {
                if (currentBatch.length > 0) chunks.push(runBuild({ embeds: currentBatch }, ctx, opts));
                currentBatch = [];
                currentWeight = 0;
            }

            currentBatch.push(emb);
            currentWeight += weight;
        }

        if (currentBatch.length > 0) chunks.push(runBuild({ embeds: currentBatch }, ctx, opts));

        return chunks;
    }
}

export const EmbedEngine = new EmbedBuilderEngine({}, { strict: false });

export function buildEmbedsFromJson(layout: EmbedLayout, context: BuildContext = {}, options: BuildOptions = {}): EmbedBuildResult {
    return new EmbedBuilderEngine().build(layout, context, options);
}

export function buildEmbedsStrict(layout: EmbedLayout, context: BuildContext = {}): EmbedBuildResult {
    return new EmbedBuilderEngine().build(layout, context, { strict: true });
}

export function buildEmbedsLenient(layout: EmbedLayout, context: BuildContext = {}): EmbedBuildResult {
    return new EmbedBuilderEngine().build(layout, context, { strict: false });
}