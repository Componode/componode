import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { InviteUserDialog } from "@/ux/components/admin/invite-user-dialog";

const createMutate = vi.fn();

vi.mock("@/api/hooks/users", () => ({
  useCreateUser: vi.fn(() => ({ mutate: createMutate, isPending: false })),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from "sonner";

/** Exact problem payload from the bug report. */
const validationError = {
  type: "https://componode.io/problems/VALIDATION_FAILED",
  title: "Validation failed",
  status: 400,
  detail: "Invalid input",
  code: "VALIDATION_FAILED",
  message: "Invalid input",
  details: [
    {
      origin: "string",
      code: "too_small",
      minimum: 12,
      inclusive: true,
      path: ["password"],
      message: "Password must be at least 12 characters",
    },
  ],
  "invalid-params": [
    { name: "password", reason: "Password must be at least 12 characters" },
  ],
};

const openForm = () => {
  const utils = render(
    <MemoryRouter>
      <TooltipProvider>
        <InviteUserDialog />
      </TooltipProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText("New user"));
  return utils;
};

describe("InviteUserDialog — validation detail (bugfix 035)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("username pattern compiles under the v flag", () => {
    openForm();
    const input = document.getElementById("invite-username") as HTMLInputElement;
    expect(() => new RegExp(input.pattern, "v")).not.toThrow();
    expect(new RegExp(input.pattern, "v").test("jdoe_x-1")).toBe(true);
    expect(new RegExp(`^(?:${input.pattern})$`, "v").test("JDOE")).toBe(false);
  });

  it("password minLength matches the schema minimum", () => {
    openForm();
    const input = document.getElementById("invite-password") as HTMLInputElement;
    expect(input.minLength).toBe(12);
  });

  it("renders the API's per-field reason inline on the password field", () => {
    createMutate.mockImplementation((_vars, opts) =>
      opts.onError(validationError),
    );
    openForm();
    fireEvent.submit(document.querySelector("form")!);

    expect(
      screen.getByText("Password must be at least 12 characters"),
    ).toBeTruthy();
    const input = document.getElementById("invite-password") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("surfaces issues for fields not in the form via toast with detail", () => {
    createMutate.mockImplementation((_vars, opts) =>
      opts.onError({
        ...validationError,
        details: [
          { path: ["teamId"], message: "Team is archived" },
        ],
        "invalid-params": [{ name: "teamId", reason: "Team is archived" }],
      }),
    );
    openForm();
    fireEvent.submit(document.querySelector("form")!);

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Team is archived"),
    );
  });

  it("non-validation errors toast the problem detail, not bare text", () => {
    createMutate.mockImplementation((_vars, opts) =>
      opts.onError({ code: "AUTH_FORBIDDEN", message: "Forbidden" }),
    );
    openForm();
    fireEvent.submit(document.querySelector("form")!);

    expect(toast.error).toHaveBeenCalledWith("Forbidden");
  });
});
