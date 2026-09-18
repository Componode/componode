import { type RouteObject } from "react-router-dom";
import { AuthGuard } from "@/components/layout/auth-guard";
import { AppShell } from "@/components/layout/app-shell";
import { LoginPage } from "@/pages/login";
import { RegisterPage } from "@/pages/register";
import { OidcCallbackPage } from "@/pages/oidc-callback";
import { DashboardPage } from "@/pages/dashboard";
import { ProductsPage } from "@/pages/products";
import { ProductDetailPage } from "@/pages/product-detail";
import { LobsPage } from "@/pages/lobs";
import { TeamsPage } from "@/pages/teams";
import { ComponentsPage } from "@/pages/components";
import { ComponentDetailPage } from "@/pages/component-detail";
import { ComponentGroupsPage } from "@/pages/component-groups";
import { ImportersPage } from "@/pages/importers";
import { ImporterRunPage } from "@/pages/importer-run";
import { UsersPage } from "@/pages/users";
import { SettingsPage } from "@/pages/settings";
import { SessionsPage } from "@/pages/sessions";
import { CredentialsPage } from "@/pages/credentials";
import { ActivityPage } from "@/pages/activity";
import { NotFoundPage } from "@/pages/not-found";

// Auth pages render outside the shell (no sidebar/top bar/palette).
const authed = (element: React.ReactNode, requiredRole?: string) => (
  <AuthGuard requiredRole={requiredRole}>{element}</AuthGuard>
);

export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  { path: "/auth/oidc/callback", element: <OidcCallbackPage /> },
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: authed(<DashboardPage />) },
      { path: "products", element: authed(<ProductsPage />) },
      { path: "products/:slug", element: authed(<ProductDetailPage />) },
      { path: "lobs", element: authed(<LobsPage />) },
      { path: "teams", element: authed(<TeamsPage />) },
      { path: "components", element: authed(<ComponentsPage />) },
      { path: "components/:id", element: authed(<ComponentDetailPage />) },
      { path: "component-groups", element: authed(<ComponentGroupsPage />) },
      { path: "importers", element: authed(<ImportersPage />) },
      {
        path: "importers/:configId/runs/:runId",
        element: authed(<ImporterRunPage />),
      },
      { path: "users", element: authed(<UsersPage />, "ADMIN") },
      { path: "settings", element: authed(<SettingsPage />, "ADMIN") },
      { path: "sessions", element: authed(<SessionsPage />) },
      { path: "credentials", element: authed(<CredentialsPage />, "ADMIN") },
      { path: "activity", element: authed(<ActivityPage />, "ADMIN") },
      { path: "*", element: authed(<NotFoundPage />) },
    ],
  },
];
