import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { bootstrapSession, getSessionState, subscribeSession, type SessionState, hasBit } from '../auth/session.js';
import { AppShell } from '../shell/AppShell.js';
import { LoadingState } from '../design-system/primitives.js';
import { PluginDemoPage } from '../pages/placeholders.js';
import { DashboardHomePage } from '../pages/dashboard/HomePage.js';
import { ServersListPage, ServerSectionPage } from '../pages/servers/ServersPage.js';
import { OwnerRoutePage } from '../pages/owner/OwnerPages.js';
import { AccountPage } from '../pages/account/AccountPages.js';
import { SearchPage } from '../pages/search/SearchPage.js';
import { PreviewPage } from '../pages/preview/PreviewPage.js';
import { PublicShell } from '../public/PublicShell.js';
import { PublicHomePage } from '../pages/public/HomePage.js';
import {
  FeaturesPage,
  SecurityPage,
  FaqPage,
  DocsIndexPage,
  DocsArticlePage,
  ChangelogPage,
  IntegrationsPage,
} from '../pages/public/ContentPages.js';
import { ForbiddenPage, NotFoundPage, UnauthorizedPage } from '../pages/errors/ErrorPages.js';
import { LoginPage } from '../pages/auth/LoginPage.js';
import { CommandsPage } from '../pages/public/CommandsPage.js';
import { DynamicPublicPage } from '../pages/public/DynamicPublicPage.js';
import { PublicSiteEditorPage } from '../pages/owner/PublicSiteEditorPage.js';
import { logger } from '../lib/logger.js';

function BootstrapGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionState>(getSessionState);
  useEffect(() => {
    void bootstrapSession();
    return subscribeSession(setSession);
  }, []);
  if (session.status === 'initializing') {
    return <LoadingState label="Starting session…" />;
  }
  return <>{children}</>;
}

function RequireAuth() {
  const s = getSessionState();
  if (s.status !== 'authenticated') {
    logger.debug('web.authz.denied', { reason: 'unauthenticated' });
    return <Navigate to="/login" replace />;
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function RequireOwner() {
  const s = getSessionState();
  if (!s.isBotOwner && !hasBit('bot.owner')) {
    logger.debug('web.authz.denied', { reason: 'not_owner' });
    return <ForbiddenPage />;
  }
  return <Outlet />;
}

function RequireBit({ bit }: { bit: string }) {
  if (!hasBit(bit) && !getSessionState().isBotOwner) {
    logger.debug('web.authz.denied', { reason: 'missing_bit', bit });
    return <NotFoundPage />;
  }
  return <Outlet />;
}

function PluginDemoGuarded() {
  if (!hasBit('bot.plugins.view') && !getSessionState().isBotOwner) {
    return <NotFoundPage />;
  }
  return <PluginDemoPage />;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <BootstrapGate>
        <Routes>
          <Route element={<PublicShell />}>
            <Route path="/" element={<PublicHomePage />} />
            <Route path="/features" element={<FeaturesPage />} />
            <Route path="/commands" element={<CommandsPage />} />
            <Route path="/security" element={<SecurityPage />} />
            <Route path="/faq" element={<FaqPage />} />
            <Route path="/docs" element={<DocsIndexPage />} />
            <Route
              path="/docs/getting-started"
              element={
                <DocsArticlePage
                  title="Getting started"
                  body={`Invite {bot} using the configured invite URL, then open the dashboard to manage servers you are authorized to see.`}
                />
              }
            />
            <Route
              path="/docs/permissions"
              element={
                <DocsArticlePage
                  title="Permissions"
                  body={`{bot} evaluates capabilities through the platform hierarchy and permission resolution on the server. The browser is never the authorization authority.`}
                />
              }
            />
            <Route
              path="/docs/plugins"
              element={
                <DocsArticlePage
                  title="Plugins"
                  body={`Plugins contribute surfaces through the dashboard registry. Owner overrides customize presentation without mutating plugin source.`}
                />
              }
            />
            <Route path="/changelog" element={<ChangelogPage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="/p/:slug" element={<DynamicPublicPage />} />
          </Route>

          <Route path="/login" element={<LoginPage />} />
          <Route path="/preview" element={<PreviewPage />} />
          <Route path="/error/unauthorized" element={<UnauthorizedPage />} />
          <Route path="/error/forbidden" element={<ForbiddenPage />} />
          <Route path="/error/not-found" element={<NotFoundPage />} />

          <Route element={<RequireAuth />}>
            <Route path="/dashboard" element={<DashboardHomePage />} />
            <Route path="/dashboard/plugin-demo" element={<PluginDemoGuarded />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/account/:section" element={<AccountPage />} />

            <Route element={<RequireBit bit="bot.servers.view" />}>
              <Route path="/servers" element={<ServersListPage />} />
              <Route path="/servers/:guildId" element={<ServerSectionPage />} />
              <Route path="/servers/:guildId/:section" element={<ServerSectionPage />} />
            </Route>

            <Route element={<RequireOwner />}>
              <Route path="/owner" element={<OwnerRoutePage />} />
              <Route path="/owner/:section" element={<OwnerRoutePage />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BootstrapGate>
    </BrowserRouter>
  );
}
