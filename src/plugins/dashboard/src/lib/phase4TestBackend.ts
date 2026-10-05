/**
 * Isolated Phase 4 test backend — SQLite file under TMPDIR, alias "main".
 * Exercises real kvGet/kvSet → SqlAdapter path without production data.
 */

import {
    installIsolatedDashboardTestBackend,
    resetDashboardAdapterForTests,
} from '../../../dash-data/src/lib/store.js';

let installed = false;

export async function ensurePhase4TestBackend(): Promise<void> {
    if (installed) return;
    resetDashboardAdapterForTests();
    await installIsolatedDashboardTestBackend();
    installed = true;
}

export function resetPhase4TestBackendFlag(): void {
    installed = false;
    resetDashboardAdapterForTests();
}
