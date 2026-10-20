import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SuggestionsPage } from "@/pages/suggestions";
import type { SuggestionQueueItem } from "@/api/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockAccept = vi.fn();
const mockDismiss = vi.fn();
const mockRescan = vi.fn();
vi.mock("@/api/hooks/suggestions", () => ({
  useSuggestions: vi.fn(),
  useAcceptSuggestion: () => ({
    mutateAsync: mockAccept,
    isPending: false,
  }),
  useDismissSuggestion: () => ({
    mutateAsync: mockDismiss,
    isPending: false,
  }),
  useRescanSuggestions: () => ({
    mutateAsync: mockRescan,
    isPending: false,
  }),
}));

const mockSession = vi.fn(() => ({ data: { role: "EDITOR" } }));
vi.mock("@/api/hooks/auth", () => ({
  useSession: () => mockSession(),
}));

import { useSuggestions } from "@/api/hooks/suggestions";
const mockSuggestions = vi.mocked(useSuggestions);

const item: SuggestionQueueItem = {
  id: "s1",
  productId: "p1",
  componentId: "c1",
  reason: "NAME_MATCH",
  score: 1.05,
  status: "PENDING",
  createdAt: "2026-01-01T00:00:00Z",
  decidedAt: null,
  decidedBy: null,
  decidedByName: null,
  product: { id: "p1", name: "Billing", slug: "billing" },
  component: {
    id: "c1",
    name: "billing-repo",
    slug: "billing-repo",
    category: "REPOSITORY",
  },
};

const dismissedItem: SuggestionQueueItem = {
  ...item,
  id: "s2",
  status: "DISMISSED",
  decidedAt: "2026-01-02T00:00:00Z",
  decidedBy: "u1",
  decidedByName: "Ada",
};

function hookState(
  over: Partial<ReturnType<typeof useSuggestions>>,
) {
  return {
    data: undefined,
    isPending: false,
    error: null,
    ...over,
  } as unknown as ReturnType<typeof useSuggestions>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockSession.mockImplementation(() => ({ data: { role: "EDITOR" } }));
});

function renderPage() {
  return render(
    <MemoryRouter>
      <SuggestionsPage />
    </MemoryRouter>,
  );
}

describe("SuggestionsPage", () => {
  it("renders pending rows with endpoint links, reason chip, and score", () => {
    mockSuggestions.mockReturnValue(
      hookState({ data: { items: [item], total: 1 } }),
    );
    renderPage();
    expect(screen.getByText("Billing")).toBeTruthy();
    expect(screen.getByText("depends on")).toBeTruthy();
    expect(screen.getByText("billing-repo")).toBeTruthy();
    expect(screen.getByText("Name match")).toBeTruthy();
    expect(screen.getByText("1.05")).toBeTruthy();
    expect(screen.getByText("REPOSITORY")).toBeTruthy();
    expect(screen.getByText("1 pending")).toBeTruthy();
  });

  it("shows accept/dismiss actions for EDITOR but hides them for VIEWER", () => {
    mockSuggestions.mockReturnValue(
      hookState({ data: { items: [item], total: 1 } }),
    );
    const { unmount } = renderPage();
    expect(screen.getByLabelText("Accept billing-repo")).toBeTruthy();
    expect(screen.getByLabelText("Dismiss billing-repo")).toBeTruthy();
    expect(screen.getByText("Rescan")).toBeTruthy();
    unmount();

    mockSession.mockImplementation(() => ({ data: { role: "VIEWER" } }));
    renderPage();
    expect(screen.queryByLabelText("Accept billing-repo")).toBeNull();
    expect(screen.queryByLabelText("Dismiss billing-repo")).toBeNull();
    expect(screen.queryByText("Rescan")).toBeNull();
  });

  it("calls the accept mutation with the suggestion id", () => {
    mockSuggestions.mockReturnValue(
      hookState({ data: { items: [item], total: 1 } }),
    );
    renderPage();
    fireEvent.click(screen.getByLabelText("Accept billing-repo"));
    expect(mockAccept).toHaveBeenCalledWith("s1");
  });

  it("opens a confirmation dialog before dismissing", () => {
    mockSuggestions.mockReturnValue(
      hookState({ data: { items: [item], total: 1 } }),
    );
    renderPage();
    fireEvent.click(screen.getByLabelText("Dismiss billing-repo"));
    expect(screen.getByText("Dismiss suggestion?")).toBeTruthy();
    expect(mockDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(mockDismiss).toHaveBeenCalledWith("s1");
  });

  it("renders dismissed rows with reason, score, decider, and no actions", () => {
    mockSuggestions.mockReturnValue(
      hookState({ data: { items: [dismissedItem], total: 1 } }),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText("Suggestion status"), {
      target: { value: "DISMISSED" },
    });
    expect(screen.getByText(/dismissed by Ada/)).toBeTruthy();
    expect(screen.getByText("Name match")).toBeTruthy();
    expect(screen.getByText("1.05")).toBeTruthy();
    // Terminal rows render no action buttons.
    expect(screen.queryByLabelText("Accept billing-repo")).toBeNull();
    expect(screen.queryByLabelText("Dismiss billing-repo")).toBeNull();
  });

  it("switches to the dismissed view via the status filter", () => {
    mockSuggestions.mockReturnValue(
      hookState({ data: { items: [], total: 0 } }),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText("Suggestion status"), {
      target: { value: "DISMISSED" },
    });
    expect(mockSuggestions).toHaveBeenCalledWith("DISMISSED", 0, 50);
  });

  it("shows empty and error states", () => {
    mockSuggestions.mockReturnValue(
      hookState({ data: { items: [], total: 0 } }),
    );
    const { unmount } = renderPage();
    expect(screen.getByText("No pending suggestions")).toBeTruthy();
    unmount();

    mockSuggestions.mockReturnValue(
      hookState({ error: new Error("boom") }),
    );
    renderPage();
    expect(screen.getByText("Failed to load suggestions")).toBeTruthy();
  });
});
