import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AgentDetailPage } from "@/pages/agent-detail";

// Spec 028 US2 / T017: the detail page renders the agent-reported ops
// snapshot (labeled) and an explicit "not reported" empty state.

const idleQuery = { isPending: false, data: null, error: null, refetch: vi.fn() };
const idleMutation = { mutateAsync: vi.fn(), isPending: false };

vi.mock("@/api/hooks/agents", () => ({
  useAgent: vi.fn(),
  useAgentConfigs: vi.fn(() => idleQuery),
  useAgentRuns: vi.fn(() => idleQuery),
  useAgentSessions: vi.fn(() => idleQuery),
  useCreateAgent: vi.fn(() => idleMutation),
  useUpdateAgent: vi.fn(() => idleMutation),
  useDeleteAgent: vi.fn(() => idleMutation),
  useRevokeAgent: vi.fn(() => idleMutation),
  useRotateAgent: vi.fn(() => idleMutation),
}));

import { useAgent } from "@/api/hooks/agents";
const mockUseAgent = vi.mocked(useAgent);

afterEach(cleanup);

const baseAgent = {
  id: "a1",
  name: "edge-agent",
  status: "CONNECTED",
  agentVersion: "1.0.0",
  protocolVersion: 2,
  importerVersions: [{ name: "github", version: "1.0.0" }],
  allowedImporters: [],
  maxConcurrentJobs: 1,
  lastSeenAt: new Date().toISOString(),
  revokedAt: null,
  hasCredential: true,
  pendingEnrollment: false,
  boundConfigCount: 0,
  runningJobs: 0,
  activeRuns: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastHeartbeatAt: new Date().toISOString(),
  lastDisconnectReason: null,
};

function renderPage(agent: unknown) {
  mockUseAgent.mockReturnValue({
    isPending: false,
    data: { agent },
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useAgent>);
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/agents/a1"]}>
        <Routes>
          <Route path="/agents/:id" element={<AgentDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("agent detail — ops reporting", () => {
  it("renders the agent-reported counters block", () => {
    renderPage({
      ...baseAgent,
      reportedStatus: {
        reportedAt: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        uptimeSeconds: 3725,
        activeJobs: 1,
        jobs: { assigned: 4, completed: 2, failed: 1, cancelled: 1 },
        assetsStreamed: 87,
        credentialTests: { dispatched: 2, succeeded: 1, failed: 1 },
        secretResolutionFailures: 1,
        reconnects: 2,
      },
    });
    expect(screen.getByText("Agent-reported")).toBeTruthy();
    expect(screen.getByText("1h 2m")).toBeTruthy();
    expect(screen.getByText(/4 assigned/)).toBeTruthy();
    expect(screen.getByText("87")).toBeTruthy();
    expect(screen.getByText(/since agent start/i)).toBeTruthy();
    expect(screen.queryByText(/Not reported by this agent/)).toBeNull();
  });

  it("shows the explicit not-reported state when the snapshot is absent", () => {
    renderPage({ ...baseAgent, reportedStatus: null });
    expect(screen.getByText(/Not reported by this agent/)).toBeTruthy();
  });

  it("shows heartbeat freshness and last disconnect reason rows", () => {
    renderPage({
      ...baseAgent,
      reportedStatus: null,
      lastDisconnectReason: "heartbeat_timeout",
    });
    expect(screen.getByText("Last heartbeat")).toBeTruthy();
    expect(screen.getByText("heartbeat_timeout")).toBeTruthy();
  });
});
