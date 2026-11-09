import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  listCredentialsQuerySchema,
  listLobsQuerySchema,
  listSessionsQuerySchema,
  listTeamsQuerySchema,
  listUsersQuerySchema,
} from "@componode/core";
import { api } from "@/api/client";
import type { Paginated } from "@/api/types";
import {
  allPagesQueryString,
  buildListQueryString,
  fetchAllPages,
  type ListQueryDefaults,
  type ListQueryState,
} from "@/api/list-query";
import {
  LOB_SORT_KEYS,
  TEAM_SORT_KEYS,
  useLobs,
  useLobsList,
  useTeams,
  useTeamsList,
} from "@/api/hooks/org";
import {
  USER_FILTER_KEYS,
  USER_SORT_KEYS,
  useUsers,
  useUsersList,
} from "@/api/hooks/users";
import { SESSION_SORT_KEYS, useSessions, useSessionsList } from "@/api/hooks/sessions";
import {
  CREDENTIAL_FILTER_KEYS,
  CREDENTIAL_SORT_KEYS,
  useCredentials,
  useCredentialsList,
} from "@/api/hooks/credentials";

vi.mock("@/api/client", () => ({ api: vi.fn() }));

/**
 * Spec 068 org/admin list pages — the resolved `useListState` shape →
 * contract query string for /lobs, /teams, /users, /sessions, and
 * /credentials, plus the request URLs the paged and fetch-all hooks send.
 * Sort whitelists are checked against the core route-boundary schemas so
 * a contract change fails here before it ships.
 */

const EMPTY_PAGINATION = { page: 1, pageSize: 25, total: 0, pageCount: 0, hasNext: false };

/** Resolved list state as `useListState` returns it (incl. `defaults`). */
interface PageState extends ListQueryState {
  defaults: ListQueryDefaults;
}

const state = (
  over: Partial<PageState> = {},
  defaults: ListQueryDefaults = {},
): PageState => ({
  page: 1,
  pageSize: 25,
  sort: null,
  order: "asc",
  search: "",
  filters: {},
  defaults,
  ...over,
});

// Per-page resolved defaults — mirrors each page's useListState config.
const LOBS_DEFAULTS: ListQueryDefaults = { sort: "name", order: "asc" };
const TEAMS_DEFAULTS: ListQueryDefaults = { sort: "name", order: "asc" };
const USERS_DEFAULTS: ListQueryDefaults = {
  sort: "createdAt",
  order: "desc",
  filters: { role: "all", isActive: "all" },
};
const SESSIONS_DEFAULTS: ListQueryDefaults = { sort: "createdAt", order: "desc" };
const CREDENTIALS_DEFAULTS: ListQueryDefaults = {
  sort: "createdAt",
  order: "desc",
  filters: { status: "all" },
};

// --- sort whitelists ↔ core contract ---------------------------------------

describe("sort whitelists match the core list contracts (spec 068)", () => {
  const cases = [
    ["lobs", LOB_SORT_KEYS, listLobsQuerySchema],
    ["teams", TEAM_SORT_KEYS, listTeamsQuerySchema],
    ["users", USER_SORT_KEYS, listUsersQuerySchema],
    ["sessions", SESSION_SORT_KEYS, listSessionsQuerySchema],
    ["credentials", CREDENTIAL_SORT_KEYS, listCredentialsQuerySchema],
  ] as const;

  for (const [name, keys, schema] of cases) {
    it(`GET /${name} accepts every frontend sort key and rejects bogus ones`, () => {
      for (const key of keys) {
        expect(
          schema.safeParse({ sort: key }).success,
          `${name} sort "${key}" must be contract-legal`,
        ).toBe(true);
      }
      expect(schema.safeParse({ sort: "__not_a_sort__" }).success).toBe(false);
    });
  }

  it("pins the documented whitelists (contracts/list-contract.md)", () => {
    // FR-005: org lists sort by every displayed column — the derived counts
    // are SQL subqueries, so their keys are contract-legal sort values.
    expect([...LOB_SORT_KEYS]).toEqual(["name", "createdAt", "teamCount", "productCount"]);
    expect([...TEAM_SORT_KEYS]).toEqual([
      "name",
      "createdAt",
      "lob",
      "memberCount",
      "productCount",
      "componentCount",
    ]);
    expect([...USER_SORT_KEYS]).toEqual(["name", "role", "isActive", "lastActiveAt", "createdAt"]);
    expect([...SESSION_SORT_KEYS]).toEqual(["createdAt", "lastSeenAt", "expiresAt", "location"]);
    expect([...CREDENTIAL_SORT_KEYS]).toEqual(["name", "status", "expiresAt", "lastUsedAt", "usedByCount", "createdAt"]);
    expect([...USER_FILTER_KEYS]).toEqual(["role", "isActive"]);
    expect([...CREDENTIAL_FILTER_KEYS]).toEqual(["status"]);
  });
});

// --- buildListQueryString adapters -----------------------------------------

describe("buildListQueryString — org/admin page states", () => {
  it("lobs: default sort/order elide; non-default sort+order serialize", () => {
    expect(buildListQueryString(state({}, LOBS_DEFAULTS))).toBe("");
    expect(
      buildListQueryString(
        state({ sort: "createdAt", order: "desc" }, LOBS_DEFAULTS),
      ),
    ).toBe("?sort=createdAt&order=desc");
    expect(
      buildListQueryString(state({ search: "pay" }, LOBS_DEFAULTS)),
    ).toBe("?search=pay");
  });

  it("teams: 'lob' parent-name sort key serializes", () => {
    expect(
      buildListQueryString(state({ sort: "lob", order: "desc" }, TEAMS_DEFAULTS)),
    ).toBe("?sort=lob&order=desc");
  });

  it("users: filters pass through verbatim; 'all' sentinels elide", () => {
    // Defaults → nothing but pagination params.
    expect(buildListQueryString(state({ sort: "createdAt", order: "desc" }, USERS_DEFAULTS))).toBe("");
    // role + isActive are real API params (enum / boolean-coerced).
    expect(
      buildListQueryString(
        state(
          {
            sort: "createdAt",
            order: "desc",
            filters: { role: "ADMIN", isActive: "false" },
          },
          USERS_DEFAULTS,
        ),
      ),
    ).toBe("?role=ADMIN&isActive=false");
    // Default order is desc — asc must be sent explicitly.
    expect(
      buildListQueryString(
        state({ sort: "name", order: "asc" }, USERS_DEFAULTS),
      ),
    ).toBe("?sort=name&order=asc");
    // desc is the default direction → elided even on a non-default sort.
    expect(
      buildListQueryString(
        state({ sort: "name", order: "desc" }, USERS_DEFAULTS),
      ),
    ).toBe("?sort=name");
  });

  it("sessions: createdAt-desc default; other keys + asc serialize", () => {
    expect(buildListQueryString(state({ sort: "createdAt", order: "desc" }, SESSIONS_DEFAULTS))).toBe("");
    expect(
      buildListQueryString(
        state({ sort: "lastSeenAt", order: "asc", page: 2, pageSize: 50 }, SESSIONS_DEFAULTS),
      ),
    ).toBe("?page=2&pageSize=50&sort=lastSeenAt&order=asc");
  });

  it("credentials: status filter + search serialize; defaults elide", () => {
    expect(
      buildListQueryString(state({ sort: "createdAt", order: "desc" }, CREDENTIALS_DEFAULTS)),
    ).toBe("");
    expect(
      buildListQueryString(
        state(
          {
            sort: "name",
            order: "asc",
            search: "github",
            filters: { status: "REVOKED" },
          },
          CREDENTIALS_DEFAULTS,
        ),
      ),
    ).toBe("?sort=name&order=asc&search=github&status=REVOKED");
  });
});

// --- paged hook request URLs -----------------------------------------------

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
};

const requestedUrls = () => vi.mocked(api).mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockResolvedValue({ data: [], pagination: EMPTY_PAGINATION } as never);
});

describe("paged list hooks send the contract query string", () => {
  it("useLobsList → /lobs?…", async () => {
    const { result } = renderHook(
      () => useLobsList(state({ sort: "createdAt", order: "desc", search: "pay" }, LOBS_DEFAULTS)),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedUrls()).toEqual(["/lobs?sort=createdAt&order=desc&search=pay"]);
    expect(result.current.data?.data).toEqual([]);
    expect(result.current.data?.pagination).toEqual(EMPTY_PAGINATION);
  });

  it("useTeamsList → /teams?sort=lob", async () => {
    const { result } = renderHook(
      () => useTeamsList(state({ sort: "lob", order: "desc" }, TEAMS_DEFAULTS)),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedUrls()).toEqual(["/teams?sort=lob&order=desc"]);
  });

  it("useUsersList → /users?…&role=…&isActive=…", async () => {
    const { result } = renderHook(
      () =>
        useUsersList(
          state(
            {
              sort: "name",
              order: "asc",
              filters: { role: "ADMIN", isActive: "false" },
            },
            USERS_DEFAULTS,
          ),
        ),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedUrls()).toEqual(["/users?sort=name&order=asc&role=ADMIN&isActive=false"]);
  });

  it("useSessionsList → /sessions?page=…&pageSize=…&sort=…", async () => {
    const { result } = renderHook(
      () =>
        useSessionsList(
          state(
            { sort: "expiresAt", order: "asc", page: 2, pageSize: 50 },
            SESSIONS_DEFAULTS,
          ),
        ),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedUrls()).toEqual(["/sessions?page=2&pageSize=50&sort=expiresAt&order=asc"]);
  });

  it("useCredentialsList → /credentials?…&status=…", async () => {
    const { result } = renderHook(
      () =>
        useCredentialsList(
          state(
            {
              sort: "name",
              order: "asc",
              filters: { status: "REVOKED" },
            },
            CREDENTIALS_DEFAULTS,
          ),
        ),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedUrls()).toEqual(["/credentials?sort=name&order=asc&status=REVOKED"]);
  });
});

// --- fetch-all sweeps (exempt pickers/lookups) ------------------------------

describe("fetch-all sweeps for exempt consumers", () => {
  const page = (n: number, hasNext: boolean) => ({
    data: [{ id: `row-${n}` }],
    pagination: { page: n, pageSize: 100, total: 2, pageCount: 2, hasNext },
  });

  it("fetchAllPages collects rows until hasNext is false", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(page(1, true) as never)
      .mockResolvedValueOnce(page(2, false) as never);
    const rows = await fetchAllPages<{ id: string }>((p) =>
      api<Paginated<{ id: string }>>(`/x${allPagesQueryString(p)}`),
    );
    expect(rows).toEqual([{ id: "row-1" }, { id: "row-2" }]);
    expect(requestedUrls()).toEqual(["/x?pageSize=100", "/x?page=2&pageSize=100"]);
  });

  it.each([
    ["useLobs", useLobs, "/lobs", "lobs"],
    ["useTeams", useTeams, "/teams", "teams"],
    ["useUsers", useUsers, "/users", "users"],
    ["useSessions", useSessions, "/sessions", "sessions"],
    ["useCredentials", useCredentials, "/credentials", "credentials"],
  ] as const)("%s pages the list endpoint and re-wraps { %s }", async (_name, hook, path, key) => {
    vi.mocked(api)
      .mockResolvedValueOnce(page(1, true) as never)
      .mockResolvedValueOnce(page(2, false) as never);
    const { result } = renderHook(() => hook(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedUrls()).toEqual([`${path}?pageSize=100`, `${path}?page=2&pageSize=100`]);
    expect(result.current.data).toEqual({ [key]: [{ id: "row-1" }, { id: "row-2" }] });
  });
});
