import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor, screen } from "@testing-library/react";
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

  it("accepts multi-line PEM via textarea and file upload for STORED values", async () => {
    const { container } = render(
      <MemoryRouter>
        <TooltipProvider>
          <CredentialForm
            mode="rotate"
            credential={{ id: "c1", label: "Docker mTLS", kind: "STORED", keyHints: { clientCert: "pem", clientKey: "pem" } }}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    // Value fields are multi-line textareas (PEM survives paste) with a file picker.
    const certArea = document.getElementById("c-value-0") as HTMLTextAreaElement;
    expect(certArea.tagName).toBe("TEXTAREA");
    const certPem = "-----BEGIN CERTIFICATE-----\nMIIB-cert\n-----END CERTIFICATE-----\n";
    const keyPem = "-----BEGIN EC PRIVATE KEY-----\nMHc-key\n-----END EC PRIVATE KEY-----\n";
    // Paste preserves interior newlines; upload loads file contents.
    fireEvent.change(certArea, { target: { value: certPem } });
    fireEvent.change(document.getElementById("c-value-1-file")!, {
      target: { files: [new File([keyPem], "client-key.pem")] },
    });
    await waitFor(() =>
      expect((document.getElementById("c-value-1") as HTMLTextAreaElement).value).toBe(keyPem),
    );
    expect(screen.getByText("client-key.pem")).toBeTruthy();
    fireEvent.submit(container.querySelector("form")!);
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        secrets: {
          clientCert: certPem.trim(),
          clientKey: keyPem.trim(),
        },
      }),
      expect.anything(),
    );
  });
});
