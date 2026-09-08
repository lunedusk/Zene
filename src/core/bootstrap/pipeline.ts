import { secrets } from '#core/helpers/secretManager.js';
import { common777 } from '#core/internal/common777.js';
import { expandProcessEnv } from '#core/placeholder/index.js';
import { materializeBootEnv } from '#core/defaults.js';

/**
 * Ordered environment preparation shared by bot mode and updater-only mode.
 * Behaviour of common777 ENVSettings is unchanged.
 *
 * Order: materialize boot defaults → assimilate → expand placeholders → lock → common777.
 */
export function runBootPipeline(): void {
    materializeBootEnv();
    secrets.assimilateEnv();
    expandProcessEnv();
    secrets.lock();
    common777.bootstrap();
}
