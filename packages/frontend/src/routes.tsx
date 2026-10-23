import { Navigate, useLocation, type RouteObject } from "react-router-dom";
import { AuthGuard } from "@/ux/lib/auth-guard";
import { NotFoundState } from "@/ux/components/patterns/states";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { LoginPage } from "@/pages/login";
import { RegisterPage } from "@/pages/register";
import { OidcCallbackPage } from "@/pages/oidc-callback";
import { UxShell } from "@/ux/ux-shell";
import { UxIndexPage } from "@/ux/app/index";
import { UxProductsPage } from "@/ux/app/products/index";
import { UxProductDetailPage } from "@/ux/app/products/$slug";
import { UxProductNewPage } from "@/ux/app/products/new";
import { UxProductImportPage } from "@/ux/app/products/import";
import { UxProductEditPage } from "@/ux/app/products/$slug.edit";
import { UxProductHistoryPage } from "@/ux/app/products/$slug.history";
import { UxComponentsPage } from "@/ux/app/components/index";
import { UxComponentDetailPage } from "@/ux/app/components/$slug";
import { UxComponentPromotePage } from "@/ux/app/components/$slug.promote";
import { UxComponentHistoryPage } from "@/ux/app/components/$slug.history";
import { UxComponentGroupsPage } from "@/ux/app/component-groups/index";
import { UxComponentGroupDetailPage } from "@/ux/app/component-groups/$slug";
import { UxSuggestionsPage } from "@/ux/app/suggestions";
import { UxActivityPage } from "@/ux/app/activity";
import { UxStandardsPage } from "@/ux/app/standards/index";
import { UxUsersPage } from "@/ux/app/users";
import { UxUserDetailPage } from "@/ux/app/users/$id";
import { UxSessionsPage } from "@/ux/app/sessions";
import { UxCredentialsPage } from "@/ux/app/credentials";
import { UxCredentialDetailPage } from "@/ux/app/credentials/$id";
import { UxCredentialNewPage } from "@/ux/app/credentials/new";
import { UxCredentialEditPage } from "@/ux/app/credentials/$id.edit";
import { UxTeamsPage } from "@/ux/app/teams";
import { UxTeamDetailPage } from "@/ux/app/teams/$slug";
import { UxLobsPage } from "@/ux/app/lobs";
import { UxLobDetailPage } from "@/ux/app/lobs/$slug";
import { SettingsShell } from "@/ux/components/settings/settings-shell";
import { UxSettingsProfilePage } from "@/ux/app/settings/profile";
import { UxSettingsAppearancePage } from "@/ux/app/settings/appearance";
import { UxSettingsSecurityPage } from "@/ux/app/settings/security";
import { UxSettingsNotificationsPage } from "@/ux/app/settings/notifications";
import { UxSettingsWorkspacePage } from "@/ux/app/settings/workspace";
import { UxSettingsAuthenticationPage } from "@/ux/app/settings/authentication";
import { UxSettingsSessionPolicyPage } from "@/ux/app/settings/session-policy";
import { UxSettingsAdvancedPage } from "@/ux/app/settings/advanced";
import { UxWiringPage } from "@/ux/app/standards/wiring";
import { UxImportersPage } from "@/ux/app/importers/index";
import { UxImporterDetailPage } from "@/ux/app/importers/$id";
import { UxImporterNewPage } from "@/ux/app/importers/new";
import { UxImporterEditPage } from "@/ux/app/importers/$id.edit";
import { UxRunDetailPage } from "@/ux/app/importers/$id.runs.$runId";
import { UxAgentsPage } from "@/ux/app/agents/index";
import { UxAgentDetailPage } from "@/ux/app/agents/$id";

// Auth pages render outside the shell (no sidebar/top bar/palette).
const authed = (element: React.ReactNode, requiredRole?: string) => (
  <AuthGuard requiredRole={requiredRole}>{element}</AuthGuard>
);

/** Legacy `/ux/*` staging prefix — permanent redirect to the real route. */
function UxRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={`${pathname.replace(/^\/ux/, "") || "/"}${search}`} replace />;
}

export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  { path: "/auth/oidc/callback", element: <OidcCallbackPage /> },
  { path: "/ux/*", element: <UxRedirect /> },
  {
    path: "/",
    element: <UxShell />,
    children: [
      { index: true, element: authed(<UxIndexPage />) },
      { path: "products", element: authed(<UxProductsPage />) },
      { path: "products/new", element: authed(<UxProductNewPage />) },
      { path: "products/import", element: authed(<UxProductImportPage />) },
      { path: "products/:slug", element: authed(<UxProductDetailPage />) },
      { path: "products/:slug/edit", element: authed(<UxProductEditPage />) },
      { path: "products/:slug/history", element: authed(<UxProductHistoryPage />) },
      { path: "components", element: authed(<UxComponentsPage />) },
      { path: "components/:slug", element: authed(<UxComponentDetailPage />) },
      { path: "components/:slug/promote", element: authed(<UxComponentPromotePage />) },
      { path: "components/:slug/history", element: authed(<UxComponentHistoryPage />) },
      { path: "component-groups", element: authed(<UxComponentGroupsPage />) },
      { path: "component-groups/:slug", element: authed(<UxComponentGroupDetailPage />) },
      { path: "suggestions", element: authed(<UxSuggestionsPage />) },
      { path: "importers", element: authed(<UxImportersPage />) },
      { path: "importers/new", element: authed(<UxImporterNewPage />) },
      { path: "importers/:id", element: authed(<UxImporterDetailPage />) },
      { path: "importers/:id/edit", element: authed(<UxImporterEditPage />) },
      { path: "importers/:id/runs/:runId", element: authed(<UxRunDetailPage />) },
      { path: "agents", element: authed(<UxAgentsPage />, "ADMIN") },
      { path: "agents/:id", element: authed(<UxAgentDetailPage />, "ADMIN") },
      { path: "users", element: authed(<UxUsersPage />, "ADMIN") },
      { path: "users/:id", element: authed(<UxUserDetailPage />, "ADMIN") },
      { path: "sessions", element: authed(<UxSessionsPage />) },
      { path: "credentials", element: authed(<UxCredentialsPage />, "ADMIN") },
      { path: "credentials/new", element: authed(<UxCredentialNewPage />, "ADMIN") },
      { path: "credentials/:id", element: authed(<UxCredentialDetailPage />, "ADMIN") },
      { path: "credentials/:id/edit", element: authed(<UxCredentialEditPage />, "ADMIN") },
      { path: "teams", element: authed(<UxTeamsPage />) },
      { path: "teams/:slug", element: authed(<UxTeamDetailPage />) },
      { path: "lobs", element: authed(<UxLobsPage />) },
      { path: "lobs/:slug", element: authed(<UxLobDetailPage />) },
      { path: "activity", element: authed(<UxActivityPage />, "ADMIN") },
      {
        path: "settings",
        element: authed(<SettingsShell />),
        children: [
          { index: true, element: <Navigate to="/settings/profile" replace /> },
          { path: "profile", element: authed(<UxSettingsProfilePage />) },
          { path: "appearance", element: authed(<UxSettingsAppearancePage />) },
          { path: "security", element: authed(<UxSettingsSecurityPage />) },
          { path: "notifications", element: authed(<UxSettingsNotificationsPage />) },
          { path: "workspace", element: authed(<UxSettingsWorkspacePage />, "ADMIN") },
          { path: "authentication", element: authed(<UxSettingsAuthenticationPage />, "ADMIN") },
          { path: "session-policy", element: authed(<UxSettingsSessionPolicyPage />, "ADMIN") },
          { path: "advanced", element: authed(<UxSettingsAdvancedPage />, "ADMIN") },
        ],
      },
      { path: "standards", element: authed(<UxStandardsPage />) },
      { path: "standards/wiring", element: authed(<UxWiringPage />) },
      { path: "design-system", element: <Navigate to="/standards" replace /> },
      {
        path: "*",
        element: authed(
          <PageContainer>
            <NotFoundState backHref="/" backLabel="Dashboard" />
          </PageContainer>,
        ),
      },
    ],
  },
];
