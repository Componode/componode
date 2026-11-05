import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DockerSetupWizard } from "@/ux/components/importers/docker-setup-wizard";

const probeMutate = vi.fn();
const createTargetMutate = vi.fn();
const createCredMutate = vi.fn();
const createConfigMutate = vi.fn();
const navigateMock = vi.fn();
let credentialsList: unknown[] = [];

vi.mock("@/api/hooks/docker-targets", () => ({
  useProbeDockerTarget: () => ({ mutateAsync: probeMutate, isPending: false }),
  useCreateDockerTarget: () => ({ mutateAsync: createTargetMutate, isPending: false }),
}));
vi.mock("@/api/hooks/credentials", () => ({
  useCredentials: () => ({ data: { credentials: credentialsList }, isPending: false }),
  useCreateCredential: () => ({ mutateAsync: createCredMutate, isPending: false }),
}));
vi.mock("@/api/hooks/importers", () => ({
  useCreateImporterConfig: () => ({ mutateAsync: createConfigMutate, isPending: false }),
}));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => navigateMock };
});

const renderWizard = () =>
  render(
    <MemoryRouter>
      <DockerSetupWizard />
    </MemoryRouter>,
  );

const pick = (triggerId: string, label: string) => {
  const trigger = document.getElementById(triggerId)!;
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const item = Array.from(document.querySelectorAll('[data-slot="select-item"]')).find(
    (el) => el.textContent === label,
  )!;
  fireEvent.click(item);
};

const fill = (id: string, value: string) =>
  fireEvent.change(document.getElementById(id)!, { target: { value } });

const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));

describe("DockerSetupWizard (spec 063)", () => {
  beforeEach(() => {
    credentialsList = [];
    probeMutate.mockResolvedValue({ ok: true });
    createTargetMutate.mockResolvedValue({ target: { id: "row-1", targetId: "prod-docker", label: "Prod" } });
    createCredMutate.mockResolvedValue({ credential: { id: "cred-1" } });
    createConfigMutate.mockResolvedValue({ config: { id: "cfg-1" } });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("socket path skips the secrets step and creates target+config without a credential", async () => {
    renderWizard();
    // Route step — socket is the default transport.
    expect(screen.getByText(/mount the Docker socket/i)).toBeTruthy();
    fill("ds-path", "/var/run/docker.sock");
    next();
    // Secrets step is skipped for socket — we land on identity.
    expect(document.getElementById("ds-label")).toBeTruthy();
    expect(document.getElementById("ds-sec-clientCert")).toBeNull();
    fill("ds-label", "Prod Docker");
    // Suggested targetId tracks the label.
    await waitFor(() => expect((document.getElementById("ds-targetid") as HTMLInputElement).value).toBe("prod-docker"));
    next();
    // Verify & create step.
    fireEvent.click(screen.getByRole("button", { name: /verify & create/i }));
    await waitFor(() => expect(probeMutate).toHaveBeenCalled());
    expect(probeMutate).toHaveBeenCalledWith({ profile: { transport: "socket", path: "/var/run/docker.sock" } });
    await waitFor(() => expect(createConfigMutate).toHaveBeenCalled());
    expect(createTargetMutate).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: "prod-docker", profile: { transport: "socket", path: "/var/run/docker.sock" } }),
    );
    expect(createCredMutate).not.toHaveBeenCalled();
    expect(createConfigMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        importerName: "docker",
        label: "Prod Docker",
        scope: { targetId: "prod-docker" },
        credentialIds: [],
        agentId: null,
      }),
    );
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/importers/cfg-1"));
    // Probe ran before any create.
    const probeOrder = probeMutate.mock.invocationCallOrder[0]!;
    expect(probeOrder).toBeLessThan(createTargetMutate.mock.invocationCallOrder[0]!);
    expect(createTargetMutate.mock.invocationCallOrder[0]!).toBeLessThan(createConfigMutate.mock.invocationCallOrder[0]!);
  });

  it("tcp shows masked secret inputs and creates a credential with canonical keys", async () => {
    renderWizard();
    pick("ds-transport", "TCP (mutual TLS)");
    fill("ds-host", "engine.example.com");
    fill("ds-port", "2376");
    next();
    // Secrets step — masked inputs for canonical keys.
    const cert = document.getElementById("ds-sec-clientCert") as HTMLInputElement;
    const key = document.getElementById("ds-sec-clientKey") as HTMLInputElement;
    const ca = document.getElementById("ds-sec-caCert") as HTMLInputElement;
    expect(cert.type).toBe("password");
    expect(key.type).toBe("password");
    expect(ca.type).toBe("password");
    // Required validation blocks advancing without values.
    next();
    expect(screen.getByText(/Client certificate \(PEM\) is required/i)).toBeTruthy();
    fireEvent.change(cert, { target: { value: "CERT" } });
    fireEvent.change(key, { target: { value: "KEY" } });
    // caCert left empty — optional.
    next();
    fill("ds-label", "MTLS engine");
    next();
    fireEvent.click(screen.getByRole("button", { name: /verify & create/i }));
    await waitFor(() => expect(probeMutate).toHaveBeenCalled());
    expect(probeMutate).toHaveBeenCalledWith({
      profile: {
        transport: "tcp",
        host: "engine.example.com",
        port: 2376,
        clientCertKey: "clientCert",
        clientKeyKey: "clientKey",
      },
      secrets: { clientCert: "CERT", clientKey: "KEY" },
    });
    await waitFor(() => expect(createCredMutate).toHaveBeenCalled());
    expect(createCredMutate).toHaveBeenCalledWith({
      kind: "STORED",
      label: "Docker — MTLS engine",
      secrets: { clientCert: "CERT", clientKey: "KEY" },
    });
    expect(createTargetMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ clientCertKey: "clientCert", clientKeyKey: "clientKey" }),
      }),
    );
    expect((createTargetMutate.mock.calls[0]![0].profile as Record<string, unknown>).caCertKey).toBeUndefined();
    await waitFor(() => expect(createConfigMutate).toHaveBeenCalledWith(
      expect.objectContaining({ credentialIds: ["cred-1"] }),
    ));
  });

  it("offers covering STORED credentials for reuse and probes with credentialId", async () => {
    credentialsList = [
      { id: "cred-cover", label: "MTLS bundle", kind: "STORED", status: "ACTIVE", keyHints: { clientCert: "c", clientKey: "k" } },
      { id: "cred-partial", label: "Partial", kind: "STORED", status: "ACTIVE", keyHints: { clientCert: "c" } },
      { id: "cred-agent", label: "Agent managed", kind: "AGENT_MANAGED", status: "ACTIVE", keyHints: { clientCert: "c", clientKey: "k" } },
    ];
    renderWizard();
    pick("ds-transport", "TCP (mutual TLS)");
    fill("ds-host", "engine.example.com");
    fill("ds-port", "2376");
    next();
    // Switch to reuse mode — only the covering STORED credential is listed.
    pick("ds-secretmode", "Reuse an existing credential");
    fireEvent.keyDown(document.getElementById("ds-reusecred")!, { key: "ArrowDown" });
    const items = Array.from(document.querySelectorAll('[data-slot="select-item"]')).map((el) => el.textContent);
    expect(items).toContain("MTLS bundle");
    expect(items).not.toContain("Partial");
    expect(items).not.toContain("Agent managed");
    const item = Array.from(document.querySelectorAll('[data-slot="select-item"]')).find((el) => el.textContent === "MTLS bundle")!;
    fireEvent.click(item);
    next();
    fill("ds-label", "Reused cred");
    next();
    fireEvent.click(screen.getByRole("button", { name: /verify & create/i }));
    await waitFor(() => expect(probeMutate).toHaveBeenCalled());
    expect(probeMutate).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: "cred-cover" }),
    );
    expect(probeMutate.mock.calls[0]![0]).not.toHaveProperty("secrets");
    // No new credential created; config links the reused one.
    expect(createCredMutate).not.toHaveBeenCalled();
    await waitFor(() => expect(createConfigMutate).toHaveBeenCalledWith(
      expect.objectContaining({ credentialIds: ["cred-cover"] }),
    ));
  });

  it("surfaces probe failure without creating anything", async () => {
    probeMutate.mockResolvedValue({ ok: false, error: "Docker probe failed: connect ECONNREFUSED" });
    renderWizard();
    fill("ds-path", "/var/run/docker.sock");
    next();
    fill("ds-label", "Prod Docker");
    next();
    fireEvent.click(screen.getByRole("button", { name: /verify & create/i }));
    await waitFor(() => expect(screen.getByText(/Verify connection failed/i)).toBeTruthy());
    expect(screen.getByText(/ECONNREFUSED/)).toBeTruthy();
    expect(createTargetMutate).not.toHaveBeenCalled();
    expect(createConfigMutate).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("reports which step failed on partial creation and keeps artifacts for retry", async () => {
    createConfigMutate.mockRejectedValue(Object.assign(new Error("boom"), { code: "VALIDATION_FAILED" }));
    renderWizard();
    fill("ds-path", "/var/run/docker.sock");
    next();
    fill("ds-label", "Prod Docker");
    next();
    fireEvent.click(screen.getByRole("button", { name: /verify & create/i }));
    await waitFor(() => expect(screen.getByText(/Create importer failed/i)).toBeTruthy());
    // Target was created; the failure panel links to it.
    expect(createTargetMutate).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "target" })).toBeTruthy();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("targetId suggestion is editable and validates length", async () => {
    renderWizard();
    fill("ds-path", "/var/run/docker.sock");
    next();
    fill("ds-label", "Prod Docker");
    const targetInput = document.getElementById("ds-targetid") as HTMLInputElement;
    await waitFor(() => expect(targetInput.value).toBe("prod-docker"));
    fireEvent.change(targetInput, { target: { value: "custom-id" } });
    expect(targetInput.value).toBe("custom-id");
    fireEvent.change(targetInput, { target: { value: "x".repeat(201) } });
    next();
    expect(screen.getByText(/200 characters or fewer/i)).toBeTruthy();
  });
});
