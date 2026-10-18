import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PlatformCandidatesSection } from "@/components/platform-candidates";

vi.mock("@/api/hooks/components", () => ({
  usePlatformCandidates: vi.fn(),
}));

const mockSession = vi.fn(() => ({ data: { role: "EDITOR" } }));
vi.mock("@/api/hooks/auth", () => ({
  useSession: () => mockSession(),
}));

import { usePlatformCandidates } from "@/api/hooks/components";
const mockCandidates = vi.mocked(usePlatformCandidates);

const candidate = {
  component: {
    id: "comp-1",
    name: "payments-repo",
    slug: "payments-repo",
    category: "REPOSITORY",
    provider: "GITHUB",
  },
  dependerCount: 2,
  dependents: [
    { id: "p1", name: "Checkout", slug: "checkout", type: "CUSTOMER_FACING" },
    { id: "p2", name: "Orders", slug: "orders", type: "BUSINESS_CAPABILITY" },
  ],
};

function hookState(
  over: Partial<ReturnType<typeof usePlatformCandidates>>,
) {
  return {
    data: undefined,
    isPending: false,
    error: null,
    ...over,
  } as unknown as ReturnType<typeof usePlatformCandidates>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockSession.mockImplementation(() => ({ data: { role: "EDITOR" } }));
});

function renderSection(onPromote?: (c: unknown) => void) {
  return render(
    <MemoryRouter>
      <PlatformCandidatesSection onPromote={onPromote} />
    </MemoryRouter>,
  );
}

describe("PlatformCandidatesSection", () => {
  it("lists each candidate with a component link, count, and dependent product links", () => {
    mockCandidates.mockReturnValue(hookState({ data: [candidate] }));
    renderSection();

    expect(screen.getByText("Platform candidates")).toBeDefined();
    expect(
      screen.getByText(/depended on by 2 products/),
    ).toBeDefined();

    const compLink = screen.getByRole("link", { name: "payments-repo" });
    expect(compLink.getAttribute("href")).toBe("/components/comp-1");

    const checkout = screen.getByRole("link", { name: "Checkout" });
    expect(checkout.getAttribute("href")).toBe("/products/checkout");
    const orders = screen.getByRole("link", { name: "Orders" });
    expect(orders.getAttribute("href")).toBe("/products/orders");
  });

  it("is hidden when the candidate list is empty", () => {
    mockCandidates.mockReturnValue(hookState({ data: [] }));
    renderSection();
    expect(screen.queryByText("Platform candidates")).toBeNull();
  });

  it("is hidden while loading and on error", () => {
    mockCandidates.mockReturnValue(hookState({ isPending: true }));
    const { unmount } = renderSection();
    expect(screen.queryByText("Platform candidates")).toBeNull();
    unmount();

    mockCandidates.mockReturnValue(
      hookState({ error: new Error("nope") }),
    );
    renderSection();
    expect(screen.queryByText("Platform candidates")).toBeNull();
  });

  it("shows a Promote button to EDITOR when onPromote is provided", () => {
    mockCandidates.mockReturnValue(hookState({ data: [candidate] }));
    const onPromote = vi.fn();
    renderSection(onPromote);
    const btn = screen.getByRole("button", { name: /promote/i });
    fireEvent.click(btn);
    expect(onPromote).toHaveBeenCalledWith(candidate);
  });

  it("hides the Promote button for VIEWER", () => {
    mockSession.mockImplementation(() => ({ data: { role: "VIEWER" } }));
    mockCandidates.mockReturnValue(hookState({ data: [candidate] }));
    renderSection(vi.fn());
    expect(screen.queryByRole("button", { name: /promote/i })).toBeNull();
    // Links still render for inspection.
    expect(screen.getByRole("link", { name: "Checkout" })).toBeDefined();
  });
});
