import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { UxSettingsProfilePage } from "@/ux/app/settings/profile";

const updateSelfMutate = vi.fn();
const updateUserMutate = vi.fn();

vi.mock("@/api/hooks/users", () => ({
  useUpdateSelf: vi.fn(() => ({ mutate: updateSelfMutate, isPending: false })),
  useUpdateUser: vi.fn(() => ({ mutate: updateUserMutate, isPending: false })),
}));

vi.mock("@/ux/components/app/session-context", () => ({
  useSession: () => ({
    user: {
      id: "u1",
      username: "viewer1",
      displayName: "View Only",
      email: "view@example.com",
      role: "VIEWER",
      isActive: true,
      lastActiveAt: null,
      createdAt: "x",
    },
  }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const wrap = (el: React.ReactElement) =>
  render(
    <MemoryRouter>
      <TooltipProvider>{el}</TooltipProvider>
    </MemoryRouter>,
  );

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("UxSettingsProfilePage — self-service profile (spec 030, G14)", () => {
  it("renders an editable form for a non-admin user with no admin fallback", () => {
    const { container } = wrap(<UxSettingsProfilePage />);
    expect(container.querySelector("fieldset[disabled]")).toBeNull();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeTruthy();
    expect(
      screen.queryByText(/only workspace admins can update profiles/i),
    ).toBeNull();
  });

  it("saves through the self-service mutation, not the admin user update", () => {
    wrap(<UxSettingsProfilePage />);
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "New Name" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(updateSelfMutate).toHaveBeenCalledWith(
      { displayName: "New Name", email: "view@example.com" },
      expect.anything(),
    );
    expect(updateUserMutate).not.toHaveBeenCalled();
  });

  it("cleared display name submits an empty string — clearing follows API rules", () => {
    wrap(<UxSettingsProfilePage />);
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(updateSelfMutate).toHaveBeenCalledWith(
      { displayName: "", email: "view@example.com" },
      expect.anything(),
    );
  });
});
