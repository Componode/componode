import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { UrlChecksCard } from "@/ux/components/catalog/url-checks-card";
import { MonitoringSetupEditor } from "@/ux/components/catalog/monitoring-setup-editor";
import { ComponentInstanceCreateDialog } from "@/ux/components/catalog/component-instance-create-dialog";
import { UrlCheckDetail } from "@/ux/components/catalog/url-check-detail";
import { useUrlCheckObservations } from "@/api/hooks/url-checks";

const useUrlCheckObservationsMock = vi.mocked(useUrlCheckObservations);

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const setupMutate = vi.fn();
const createInstanceMutate = vi.fn();
const sessionRole = { role: "EDITOR" as string };
const urlChecksImpl: { fn: () => unknown } = {
  fn: () => ({
    data: { setup: null, checks: [] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
};
const checkImpl: { fn: (id: string | null) => unknown } = {
  fn: () => ({ data: null, isPending: false, error: null }),
};
const setupImpl: { fn: () => unknown } = {
  fn: () => ({ data: { setup: null }, isPending: false, error: null }),
};
const metricsImpl: { fn: (id: string | null, window: string) => unknown } = {
  fn: () => ({ data: undefined, isPending: false, error: null }),
};
const observationsImpl: { fn: () => unknown } = {
  fn: () => ({
    data: { pages: [{ observations: [], nextBefore: null }] },
    isPending: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
};
const credentialsImpl: { fn: () => unknown } = {
  fn: () => ({
    data: {
      credentials: [
        {
          id: "cred-1",
          label: "Storefront API key",
          kind: "STORED",
          status: "ACTIVE",
          keyHints: { token: "…1234" },
          expiresAt: null,
          lastUsedAt: null,
          updatedBy: "u1",
          usedBy: 0,
        },
      ],
    },
    isPending: false,
    isError: false,
  }),
};
const agentsImpl: { fn: () => unknown } = {
  fn: () => ({ data: { agents: [] }, isPending: false, isError: false }),
};

vi.mock("@/api/hooks/auth", () => ({
  useSession: vi.fn(() => ({
    data: { id: "u1", username: "ed", role: sessionRole.role },
  })),
}));
vi.mock("@/api/hooks/url-checks", () => ({
  useMonitoringSetup: vi.fn(() => setupImpl.fn()),
  useUpdateMonitoringSetup: vi.fn(() => ({
    mutate: setupMutate,
    isPending: false,
  })),
  useUrlChecks: vi.fn(() => urlChecksImpl.fn()),
  useUrlCheck: vi.fn((id: string | null) => checkImpl.fn(id)),
  useUrlCheckMetrics: vi.fn((id: string | null, window: string) =>
    metricsImpl.fn(id, window),
  ),
  useUrlCheckObservations: vi.fn(() => observationsImpl.fn()),
}));
vi.mock("@/api/hooks/components", () => ({
  useCreateComponentInstance: vi.fn(() => ({
    mutate: createInstanceMutate,
    isPending: false,
  })),
}));
vi.mock("@/api/hooks/credentials", () => ({
  useCredentials: vi.fn(() => credentialsImpl.fn()),
}));
vi.mock("@/api/hooks/agents", () => ({
  useAgents: vi.fn(() => agentsImpl.fn()),
}));
vi.mock("@/api/hooks/org", () => ({
  useTeams: vi.fn(() => ({ data: { teams: [] }, isPending: false })),
}));
vi.mock("@/api/hooks/component-groups", () => ({
  useComponentGroups: vi.fn(() => ({ data: { groups: [] }, isPending: false })),
}));

const wrap = (el: React.ReactElement) =>
  render(
    <MemoryRouter>
      <TooltipProvider>{el}</TooltipProvider>
    </MemoryRouter>,
  );

const pick = (triggerId: string, label: string) => {
  const trigger = document.getElementById(triggerId)!;
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const item = Array.from(
    document.querySelectorAll('[data-slot="select-item"]'),
  ).find((el) => el.textContent === label)!;
  fireEvent.click(item);
};

const component = {
  id: "c1",
  name: "payments-api",
  slug: "payments-api",
  category: "API",
  provider: "OTHER" as const,
  resourceType: "service",
  lifecycle: "ACTIVE" as const,
  componentGroupId: null,
  componentGroupName: null,
  teamOwnerId: null,
  teamOwnerName: null,
  tags: [] as string[],
  links: [],
  sunsetAt: null,
  instanceCount: 1,
  instances: [
    {
      id: "i1",
      environment: "PRODUCTION" as const,
      region: null,
      status: "RUNNING" as const,
      version: null,
      url: null,
      externalId: "ext-1",
      lastSeenAt: null,
      rawConfig: null,
    },
  ],
  lastSeenAt: null,
  worstStatus: "RUNNING" as const,
  details: null,
};

const apiCheck = {
  id: "k1",
  setupId: "s1",
  componentInstanceId: "i1",
  managedKey: null,
  managedByConfigId: null,
  credentialId: null,
  name: "Storefront",
  url: "https://shop.example.com/health",
  method: "GET",
  enabled: true,
  cadenceSeconds: null,
  successPolicy: { codes: [] as number[], ranges: [{ min: 200, max: 299 }] },
  authMode: "NONE",
  authConfig: null,
  availabilityTarget: null,
  targetWindow: null,
  nextProbeAt: "2026-11-01T10:05:00Z",
  autoDisableAfter: null,
  consecutiveFailures: 0,
  autoDisabledAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: "2026-11-01T09:00:00Z",
  updatedAt: "2026-11-01T09:00:00Z",
};

const latestOk = {
  scheduledAt: "2026-11-01T10:00:00Z",
  outcome: "SUCCESS",
  httpStatus: 200,
  durationMs: 120,
  errorType: null,
  vantage: "HUB",
};

const summaryOf = (
  over: Partial<{
    availability: number | null;
    p95: number | null;
    coverageGap: number;
    counts: { success: number; failure: number; missed: number };
  }> = {},
) => ({
  window: "24h",
  availability: 0.975,
  p95: 340,
  coverageGap: 0,
  counts: { success: 39, failure: 1, missed: 0 },
  ...over,
});

const recentOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    urlCheckId: "k1",
    scheduledAt: `2026-11-01T0${9 - i}:00:00Z`,
    outcome: "SUCCESS",
    httpStatus: 200,
    durationMs: 100 + i,
    errorType: null,
    vantage: "HUB",
    agentId: null,
    createdAt: `2026-11-01T0${9 - i}:00:01Z`,
  }));

const metricsFor = (window: string) => ({
  window,
  availability: 0.975,
  errorRate: 0.02,
  coverageGap: 0.005,
  p50: 110,
  p95: 340,
  p99: 900,
  counts: { success: 39, failure: 1, missed: window === "24h" ? 1 : 0 },
  latest: latestOk,
  vantage: "HUB",
  agentName: null,
  target: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionRole.role = "EDITOR";
  urlChecksImpl.fn = () => ({
    data: { setup: null, checks: [] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  checkImpl.fn = () => ({ data: null, isPending: false, error: null });
  setupImpl.fn = () => ({
    data: { setup: null },
    isPending: false,
    error: null,
  });
  metricsImpl.fn = (_id, w) => ({
    data: metricsFor(w),
    isPending: false,
    error: null,
  });
  observationsImpl.fn = () => ({
    data: { pages: [{ observations: [], nextBefore: null }] },
    isPending: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  });
  credentialsImpl.fn = () => ({
    data: {
      credentials: [
        {
          id: "cred-1",
          label: "Storefront API key",
          kind: "STORED",
          status: "ACTIVE",
          keyHints: { token: "…1234" },
          expiresAt: null,
          lastUsedAt: null,
          updatedBy: "u1",
          usedBy: 0,
        },
      ],
    },
    isPending: false,
    isError: false,
  });
  agentsImpl.fn = () => ({
    data: { agents: [] },
    isPending: false,
    isError: false,
  });
});
afterEach(cleanup);

describe("UrlChecksCard (spec 051 US1/US3)", () => {
  it("renders check rows with a distinct check-status badge, latest code, and setup summary", () => {
    urlChecksImpl.fn = () => ({
      data: {
        setup: {
          id: "s1",
          componentId: "c1",
          cadenceSeconds: 300,
          vantage: "HUB",
          agentId: null,
          agentName: null,
          createdAt: "2026-11-01T09:00:00Z",
          updatedAt: "2026-11-01T09:00:00Z",
        },
        checks: [{ ...apiCheck, latest: latestOk }],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });

    wrap(<UrlChecksCard component={component} />);
    expect(screen.getByRole("link", { name: "Storefront" })).toBeTruthy();
    expect(screen.getByText("https://shop.example.com/health")).toBeTruthy();
    // Check status badge is distinct from instance health vocabulary.
    expect(screen.getByText("Up")).toBeTruthy();
    expect(screen.getByText("200")).toBeTruthy();
    expect(
      screen.getByText(/every 300 seconds, reachable from Hub/),
    ).toBeTruthy();
    // Link routes to the nested check detail.
    expect(
      screen.getByRole("link", { name: "Storefront" }).getAttribute("href"),
    ).toBe("/components/payments-api/checks/k1");
  });

  it("renders the 24h availability and p95 cells per row (spec 053 US1)", () => {
    urlChecksImpl.fn = () => ({
      data: {
        setup: {
          id: "s1",
          componentId: "c1",
          cadenceSeconds: 300,
          vantage: "HUB",
          agentId: null,
          agentName: null,
          createdAt: "2026-11-01T09:00:00Z",
          updatedAt: "2026-11-01T09:00:00Z",
        },
        checks: [
          {
            ...apiCheck,
            latest: latestOk,
            summary: summaryOf(),
            recent: recentOf(3),
          },
          {
            ...apiCheck,
            id: "k2",
            name: "Readiness",
            url: "https://api.example.com/ready",
            latest: latestOk,
            summary: summaryOf({
              availability: 0.5,
              p95: 1200,
              counts: { success: 1, failure: 1, missed: 0 },
            }),
            recent: [],
          },
        ],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });

    wrap(<UrlChecksCard component={component} />);
    // Window-labeled headers; vantage phrasing stays in the description.
    expect(screen.getByText("Availability (24h)")).toBeTruthy();
    expect(screen.getByText("p95 (24h)")).toBeTruthy();
    expect(screen.getByText(/reachable from Hub/)).toBeTruthy();
    // Per-row figures: 97.50% / 340 ms and 50.00% / 1200 ms.
    expect(screen.getByText("97.50%")).toBeTruthy();
    expect(screen.getByText("340 ms")).toBeTruthy();
    expect(screen.getByText("50.00%")).toBeTruthy();
    expect(screen.getByText("1200 ms")).toBeTruthy();
  });

  it("renders the empty state read-only - checks come from importer configs", () => {
    wrap(<UrlChecksCard component={component} />);
    expect(
      screen.getByText(/declared by an importer's ImporterConfig/i),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add check/i })).toBeNull();
  });

  it("offers first-instance recovery on a zero-instance component (spec 054)", () => {
    wrap(
      <UrlChecksCard
        component={{ ...component, instanceCount: 0, instances: [] }}
      />,
    );
    expect(screen.getByText(/this component has none yet/i)).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /add first instance/i }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /add check/i })).toBeNull();
  });

  it("does not offer first-instance recovery on a RETIRED component", () => {
    wrap(
      <UrlChecksCard
        component={{
          ...component,
          lifecycle: "RETIRED",
          instanceCount: 0,
          totalInstanceCount: 0,
          instances: [],
        }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /add first instance/i }),
    ).toBeNull();
  });

  it("does not offer recovery when every instance is GONE", () => {
    wrap(
      <UrlChecksCard
        component={{
          ...component,
          instanceCount: 0,
          totalInstanceCount: 1,
          instances: [],
        }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /add first instance/i }),
    ).toBeNull();
  });

  it("hides setup editing for VIEWER - checks are read-only for everyone", () => {
    sessionRole.role = "VIEWER";
    wrap(<UrlChecksCard component={component} />);
    expect(screen.queryByRole("button", { name: /add check/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /monitoring defaults/i }),
    ).toBeNull();
  });

  it("renders the outcome strip from the list payload with no per-row requests (spec 053 US2)", () => {
    urlChecksImpl.fn = () => ({
      data: {
        setup: null,
        checks: [
          {
            ...apiCheck,
            latest: latestOk,
            summary: summaryOf(),
            recent: recentOf(3),
          },
          {
            ...apiCheck,
            id: "k2",
            name: "Readiness",
            url: "https://api.example.com/ready",
            latest: latestOk,
            summary: summaryOf(),
            recent: recentOf(2).map((o) => ({
              ...o,
              id: `${o.id}-k2`,
              urlCheckId: "k2",
            })),
          },
        ],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });

    wrap(<UrlChecksCard component={component} />);
    // The table never fans out: the per-check observations hook is not called.
    expect(useUrlCheckObservationsMock).not.toHaveBeenCalled();
    // Strips still render from check.recent (role="img" aria-labels per row).
    expect(
      screen.getByRole("img", { name: "Recent outcomes for Storefront" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Recent outcomes for Readiness" }),
    ).toBeTruthy();
  });

  it("shows explicit no-data cells for a check with no observations (spec 053 US3)", () => {
    urlChecksImpl.fn = () => ({
      data: {
        setup: null,
        checks: [
          {
            ...apiCheck,
            latest: null,
            summary: summaryOf({
              availability: null,
              p95: null,
              counts: { success: 0, failure: 0, missed: 0 },
            }),
            recent: [],
          },
        ],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });

    wrap(<UrlChecksCard component={component} />);
    // Both summary cells show the honest no-data state  --  never 0%/100%.
    expect(screen.getAllByText("No data yet")).toHaveLength(2);
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("annotates the availability figure when the window has missed probes (spec 053 US3)", () => {
    urlChecksImpl.fn = () => ({
      data: {
        setup: null,
        checks: [
          {
            ...apiCheck,
            latest: latestOk,
            summary: summaryOf({
              availability: 0.5,
              coverageGap: 0.5,
              counts: { success: 1, failure: 0, missed: 1 },
            }),
            recent: recentOf(2),
          },
        ],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });

    wrap(<UrlChecksCard component={component} />);
    expect(screen.getByText("50.00%")).toBeTruthy();
    // Coverage gap stays distinguishable from endpoint failure.
    expect(screen.getByText("· 1 missed")).toBeTruthy();
  });

  it("shows a true low availability with an empty p95 for an all-failure window (spec 053 US3)", () => {
    urlChecksImpl.fn = () => ({
      data: {
        setup: null,
        checks: [
          {
            ...apiCheck,
            latest: {
              ...latestOk,
              outcome: "FAILURE",
              httpStatus: 500,
              errorType: "HTTP_STATUS",
            },
            summary: summaryOf({
              availability: 0,
              p95: null,
              counts: { success: 0, failure: 3, missed: 0 },
            }),
            recent: [],
          },
        ],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });

    wrap(<UrlChecksCard component={component} />);
    expect(screen.getByText("0.00%")).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("keeps the disabled presentation for a disabled check without implying active probing (spec 053 US3)", () => {
    urlChecksImpl.fn = () => ({
      data: {
        setup: null,
        checks: [
          {
            ...apiCheck,
            enabled: false,
            latest: latestOk,
            summary: summaryOf(),
            recent: recentOf(2),
          },
        ],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });

    wrap(<UrlChecksCard component={component} />);
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.getByText("97.50%")).toBeTruthy();
  });

  it("renders the Auto-disabled badge distinct from a manual Disabled (spec 056)", () => {
    urlChecksImpl.fn = () => ({
      data: {
        setup: null,
        checks: [
          {
            ...apiCheck,
            enabled: false,
            autoDisabledAt: "2026-11-01T10:12:00Z",
            consecutiveFailures: 12,
            latest: latestOk,
            summary: summaryOf(),
            recent: recentOf(2),
          },
        ],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });

    wrap(<UrlChecksCard component={component} />);
    expect(screen.getByText("Auto-disabled")).toBeTruthy();
    expect(screen.queryByText("Disabled")).toBeNull();
  });
});

describe("ComponentInstanceCreateDialog (spec 054)", () => {
  it("submits the first manual instance fields", () => {
    wrap(
      <ComponentInstanceCreateDialog
        component={{ id: "c1", name: "payments-api" }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /add first instance/i }),
    );
    pick("ci-environment", "Production");
    fireEvent.change(document.getElementById("ci-url")!, {
      target: { value: "https://api.example.com" },
    });
    fireEvent.change(document.getElementById("ci-version")!, {
      target: { value: "1.2.3" },
    });
    fireEvent.change(document.getElementById("ci-region")!, {
      target: { value: "us-east-1" },
    });
    fireEvent.submit(
      document.getElementById("ci-environment")!.closest("form")!,
    );

    expect(createInstanceMutate).toHaveBeenCalledWith(
      {
        environment: "PRODUCTION",
        url: "https://api.example.com",
        version: "1.2.3",
        region: "us-east-1",
      },
      expect.anything(),
    );
  });

  it("requires an environment before submitting", () => {
    wrap(
      <ComponentInstanceCreateDialog
        component={{ id: "c1", name: "payments-api" }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /add first instance/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /save instance/i }));

    expect(createInstanceMutate).not.toHaveBeenCalled();
    expect(screen.getByText("Environment is required.")).toBeTruthy();
  });
});

describe("Admin-only selector guidance (spec 054)", () => {
  it("explains unavailable Import Agents in monitoring setup", () => {
    agentsImpl.fn = () => ({
      data: undefined,
      isPending: false,
      isError: true,
    });
    wrap(<MonitoringSetupEditor componentId="c1" setup={null} />);
    fireEvent.click(
      screen.getByRole("button", { name: /monitoring defaults/i }),
    );

    expect(
      screen.getByText("Picking an Import Agent requires the Admin role."),
    ).toBeTruthy();
  });
});

describe("UrlCheckDetail (spec 051 US3/US6)", () => {
  beforeEach(() => {
    checkImpl.fn = () => ({
      data: { check: apiCheck },
      isPending: false,
      error: null,
    });
    observationsImpl.fn = () => ({
      data: {
        pages: [
          {
            observations: [
              {
                id: "o1",
                urlCheckId: "k1",
                scheduledAt: "2026-11-01T10:00:00Z",
                outcome: "FAILURE",
                httpStatus: null,
                durationMs: null,
                errorType: "TIMEOUT",
                vantage: "HUB",
                agentId: null,
                createdAt: "2026-11-01T10:00:00Z",
              },
            ],
            nextBefore: null,
          },
        ],
      },
      isPending: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    });
  });

  it("renders window-labeled metrics, coverage-gap note, and observation history", () => {
    wrap(<UrlCheckDetail component={component} checkId="k1" />);

    // Every window is labeled and phrased as reachable from the vantage.
    expect(screen.getByText("Last 24 hours")).toBeTruthy();
    expect(screen.getByText("Last 7 days")).toBeTruthy();
    expect(screen.getByText("Last 30 days")).toBeTruthy();
    expect(screen.getAllByText(/reachable from Hub/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("97.50%").length).toBeGreaterThan(0);
    // Coverage gap surfaces distinctly from endpoint failures (missed=1 on 24h).
    expect(screen.getByText(/coverage gap/)).toBeTruthy();
    // Observation history: outcome badge, status, duration, error reason.
    expect(screen.getByText("Failure")).toBeTruthy();
    expect(screen.getByText("Timed out")).toBeTruthy();
  });

  it("renders no edit/delete affordances and a Legacy badge on unmigrated checks", () => {
    wrap(<UrlCheckDetail component={component} checkId="k1" />);
    expect(screen.queryByRole("button", { name: /edit check/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete check/i })).toBeNull();
    expect(screen.getByText("Legacy")).toBeTruthy();
  });

  it("shows a Managed badge linking to the owning ImporterConfig", () => {
    checkImpl.fn = () => ({
      data: {
        check: {
          ...apiCheck,
          managedKey: "chk-1",
          managedByConfigId: "cfg-9",
        },
      },
      isPending: false,
      error: null,
    });
    wrap(<UrlCheckDetail component={component} checkId="k1" />);
    const link = screen.getByRole("link", { name: /managed/i });
    expect(link.getAttribute("href")).toBe("/importers/cfg-9");
    expect(screen.queryByRole("button", { name: /edit check/i })).toBeNull();
  });

  it("renders NotFound when the check does not belong to the component", () => {
    checkImpl.fn = () => ({
      data: { check: { ...apiCheck, componentInstanceId: "other-instance" } },
      isPending: false,
      error: null,
    });
    wrap(<UrlCheckDetail component={component} checkId="k1" />);
    expect(screen.getByText("Check not found")).toBeTruthy();
  });
});
