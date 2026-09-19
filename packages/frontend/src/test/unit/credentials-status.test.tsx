import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CredentialsPage } from "@/pages/credentials";

vi.mock("@/api/hooks/credentials", () => ({
  useCredentials: vi.fn(),
  useCreateCredential: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

// The contract under test is the table's status treatment; stub the
// dialogs/form so their hook/API needs stay out of scope.
vi.mock("@/components/credential-form", () => ({ CredentialForm: () => null }));
vi.mock("@/components/credential-test-dialog", () => ({ CredentialTestDialog: () => null }));
vi.mock("@/components/credential-lifecycle-dialogs", () => ({
  CredentialDetailDialog: () => null,
  DeleteCredentialDialog: () => null,
  RevokeCredentialDialog: () => null,
  RotateCredentialDialog: () => null,
}));

import { useCredentials } from "@/api/hooks/credentials";
const mockUseCredentials = vi.mocked(useCredentials);

const DAY = 24 * 60 * 60 * 1000;

function cred(over: Record<string, unknown>) {
  return {
    id: "cr1",
    label: "github-pat",
    keyHints: { token: "abcd" },
    status: "ACTIVE",
    expiresAt: null,
    lastUsedAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CredentialsPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CredentialsPage status treatment (FR-004)", () => {
  it("renders status with the dot+label StatusBadge, not a solid fill", () => {
    mockUseCredentials.mockReturnValue({
      data: { credentials: [cred({})] },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useCredentials>);
    renderPage();

    const statusCell = screen.getByText("ACTIVE");
    const badge = statusCell.closest("[class*='rounded-full']")!;
    expect(badge.querySelector("[data-status-dot]")).not.toBeNull();
    // status must be a tinted pill — never the solid brand fill
    expect(badge.className).not.toContain("bg-primary");
    expect(badge.className).not.toContain("text-primary-foreground");
  });

  it("renders REVOKED via the status map (dot + label)", () => {
    mockUseCredentials.mockReturnValue({
      data: { credentials: [cred({ status: "REVOKED" })] },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useCredentials>);
    renderPage();
    const badge = screen.getByText("REVOKED").closest("[class*='rounded-full']")!;
    expect(badge.querySelector("[data-status-dot]")).not.toBeNull();
    expect(badge.className).toContain("text-destructive");
  });

  it("renders expired/expiring derived states with the dot treatment", () => {
    mockUseCredentials.mockReturnValue({
      data: {
        credentials: [
          cred({ id: "a", label: "gone", expiresAt: new Date(Date.now() - DAY).toISOString() }),
          cred({ id: "b", label: "soon", expiresAt: new Date(Date.now() + DAY).toISOString() }),
        ],
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useCredentials>);
    renderPage();
    for (const label of ["EXPIRED", "EXPIRING"]) {
      const badge = screen.getByText(label).closest("[class*='rounded-full']")!;
      expect(badge.querySelector("[data-status-dot]")).not.toBeNull();
    }
    expect(screen.getByText("EXPIRED").closest("[class*='rounded-full']")!.className)
      .toContain("destructive");
    expect(screen.getByText("EXPIRING").closest("[class*='rounded-full']")!.className)
      .toContain("warning");
  });
});
