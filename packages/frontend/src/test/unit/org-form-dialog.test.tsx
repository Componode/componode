import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { OrgFormDialog } from "@/ux/components/org/org-form-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const lobA = { id: "l1", name: "Payments", slug: "payments", description: "handles money" };

const wrap = (initial?: typeof lobA, key = 0) => (
  <TooltipProvider key={key}>
    <OrgFormDialog
      noun="line of business"
      initial={initial}
      lobs={[]}
      onSubmit={vi.fn()}
      trigger={<button type="button">New LOB</button>}
    />
  </TooltipProvider>
);

describe("OrgFormDialog — stale state on reopen (F005, bugfix 036)", () => {
  afterEach(cleanup);

  it("create mode after an edit opens clean", () => {
    const utils = render(<MemoryRouter>{wrap(lobA)}</MemoryRouter>);
    fireEvent.click(screen.getByText("New LOB"));
    expect((document.getElementById("org-desc") as HTMLTextAreaElement).value).toBe("handles money");
    fireEvent.keyDown(document.body, { key: "Escape" });

    utils.rerender(<MemoryRouter>{wrap(undefined, 1)}</MemoryRouter>);
    fireEvent.click(screen.getByText("New LOB"));
    expect((document.getElementById("org-desc") as HTMLTextAreaElement).value).toBe("");
    expect((document.getElementById("org-name") as HTMLInputElement).value).toBe("");
  });

  it("reopening create mode clears typed-but-unsaved values", () => {
    render(<MemoryRouter>{wrap()}</MemoryRouter>);
    fireEvent.click(screen.getByText("New LOB"));
    fireEvent.change(document.getElementById("org-desc")!, { target: { value: "typed garbage" } });
    fireEvent.keyDown(document.body, { key: "Escape" });

    fireEvent.click(screen.getByText("New LOB"));
    expect((document.getElementById("org-desc") as HTMLTextAreaElement).value).toBe("");
  });
});
