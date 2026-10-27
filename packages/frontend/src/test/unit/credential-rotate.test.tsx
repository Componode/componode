import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { CredentialForm } from "@/ux/components/admin/credential-form";

const updateMutate = vi.fn();
const createMutate = vi.fn();
vi.mock("@/api/hooks/credentials", () => ({
  useCreateCredential: () => ({ mutate: createMutate, isPending: false }),
  useUpdateCredential: () => ({ mutate: updateMutate, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("CredentialForm rotate — PATCH payload (F010, bugfix 036)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("omits immutable `kind` from the rotate PATCH (update schema is strict)", () => {
    const { container } = render(
      <MemoryRouter>
        <TooltipProvider>
          <CredentialForm
            mode="rotate"
            credential={{ id: "c1", label: "GitHub prod", kind: "STORED", keyHints: { token: "ghp•••" } }}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    fireEvent.change(document.getElementById("c-value-0")!, { target: { value: "ghp_newsecret" } });
    fireEvent.submit(container.querySelector("form")!);

    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ secrets: expect.objectContaining({ token: "ghp_newsecret" }) }),
      expect.anything(),
    );
    expect(updateMutate.mock.calls[0]![0]).not.toHaveProperty("kind");
  });
});
