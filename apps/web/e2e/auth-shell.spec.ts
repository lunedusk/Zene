/**
 * Phase 5 — Browser E2E (Playwright).
 *
 * Real: browser navigation, DOM presence/absence, client routing.
 * Mocked: Dashboard API + auth endpoints via page.route (no live Better Auth required).
 *
 * Authorization: unauthorized routes must not render privileged content in the DOM
 * (not merely CSS-hidden).
 */

import { test, expect } from '@playwright/test';

const MOCK_USER = {
    id: 'user-e2e-1',
    name: 'E2E User',
    email: 'e2e@example.com',
};

test.describe('Phase 5 browser E2E', () => {
    test.beforeEach(async ({ page }) => {
        // Mock identity / session bootstrap if the app hits these paths
        await page.route('**/api/dash/**', async (route) => {
            const url = route.request().url();
            if (url.includes('/api/dash/auth/') || url.includes('/session')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ user: MOCK_USER, authority: 'better_auth' }),
                });
                return;
            }
            if (url.includes('/registry')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        surfaces: [{ id: 'overview', path: '/app', capability: 'dashboard.access' }],
                    }),
                });
                return;
            }
            if (url.includes('/search')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ results: [] }),
                });
                return;
            }
            await route.fulfill({
                status: 404,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'not_found' }),
            });
        });
    });

    test('app shell loads (login or authenticated entry)', async ({ page }) => {
        await page.goto('/');
        // Either public landing or app shell — document title / root must exist
        await expect(page.locator('body')).toBeVisible();
        const text = await page.locator('body').innerText();
        // Must not embed raw secrets in DOM
        expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{20,}/);
        expect(text).not.toMatch(/sk_live_/);
    });

    test('unknown privileged path does not expose admin DOM', async ({ page }) => {
        await page.goto('/app/admin/not-a-real-secret-panel');
        const body = await page.locator('body').innerText();
        // Privileged labels that must not appear for unauthorized/unknown routes
        expect(body.toLowerCase()).not.toContain('delete all users permanently');
        expect(body.toLowerCase()).not.toContain('raw bot token');
    });

    test('logout path is navigable without throwing', async ({ page }) => {
        await page.goto('/logout');
        await expect(page.locator('body')).toBeVisible();
    });
});
