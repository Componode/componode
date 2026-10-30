import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { ImporterForm } from "@/ux/components/importers/importer-form";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const createMutate = vi.fn();
const updateMutate = vi.fn();
vi.mock("@/api/hooks/importers", () => ({
  useCreateImporterConfig: () => ({ mutate: createMutate, isPending: false }),
  useUpdateImporterConfig: () => ({ mutate: updateMutate, isPending: false }),
}));

const GITHUB = {
  name: "github",
  label: "GitHub",
  description: "Import repositories",
  configSchema: {
    type: "object",
    required: ["org"],
    properties: {
      org: { type: "string", minLength: 1 },
      baseUrl: { type: "string", format: "uri" },
      repos: { type: "array", items: { type: "string", minLength: 1 } },
      includeForks: { type: "boolean", default: false },
      includeOrganization: { type: "boolean", default: true },
      billingPeriod: { type: "string", enum: ["current", "previous"], default: "current" },
      environmentMapping: {
        type: "object",
        additionalProperties: { type: "string", enum: ["PRODUCTION", "STAGING"] },
      },
    },
  },
  secrets: [{ key: "token", label: "Token", required: true }],
};

const KUBERNETES = {
  name: "kubernetes",
  label: "Kubernetes",
  description: "Import clusters",
  configSchema: {
    type: "object",
    properties: {
      namespace: { type: "string", default: "default" },
      resourceTypes: {
        type: "array",
        items: { type: "string", minLength: 1 },
        default: ["apps/v1:Deployment"],
      },
      endpoint: { type: "string", format: "uri" },
    },
  },
  secrets: [{ key: "kubeconfig", label: "Kubeconfig", required: true }],
};

const WEB_URL = {
  name: "web-url",
  label: "Web URL",
  description: "Import a web page",
  configSchema: {
    type: "object",
    required: ["url"],
    properties: { url: { type: "string", format: "uri" } },
  },
};

const manifests = [GITHUB, KUBERNETES, WEB_URL];

const renderForm = (props: Record<string, unknown> = {}, ms = manifests) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ImporterForm manifests={ms as never} credentials={[]} agents={[]} {...props} />
      </TooltipProvider>
    </MemoryRouter>,
  );

const fillLabel = () =>
  fireEvent.change(document.getElementById("i-label")!, {
    target: { value: "Test config" },
  });

const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: /create importer|save changes/i }));

const pickImporter = (label: string) => {
  const trigger = screen.getAllByRole("combobox")[0]!;
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const item = Array.from(document.querySelectorAll('[data-slot="select-item"]')).find(
    (el) => el.textContent === label,
  )!;
  fireEvent.click(item);
};

describe("ImporterForm — schema-driven scope fields (G13)", () => {
  afterEach(() => {
    cleanup();
    createMutate.mockClear();
    updateMutate.mockClear();
  });

  it("renders a typed control per schema property, not a JSON textarea", () => {
    renderForm();
    expect(document.getElementById("i-scope-org")).toBeTruthy();
    expect(document.getElementById("i-scope-baseUrl")).toBeTruthy();
    expect(document.getElementById("i-scope-environmentMapping")).toBeTruthy();
    // no raw JSON textarea in typed mode
    expect(document.getElementById("i-scope")).toBeNull();
  });

  it("marks required fields and pre-fills schema defaults", () => {
    renderForm();
    const org = document.getElementById("i-scope-org") as HTMLInputElement;
    expect(org.getAttribute("aria-required")).toBe("true");
    expect(org.value).toBe("");
    expect(
      (screen.getByRole("switch", { name: /include forks/i }) as HTMLElement).getAttribute(
        "data-state",
      ),
    ).toBe("unchecked");
    expect(
      (screen.getByRole("switch", { name: /include organization/i }) as HTMLElement).getAttribute(
        "data-state",
      ),
    ).toBe("checked");
    // enum default renders its humanized label on the trigger
    expect(screen.getByRole("combobox", { name: /billing period/i }).textContent).toMatch(
      /current/i,
    );
    // url kind renders a url input
    expect((document.getElementById("i-scope-baseUrl") as HTMLInputElement).type).toBe("url");
  });

  it("blocks submit with an inline error when a required field is empty", () => {
    renderForm();
    fillLabel();
    submit();
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/org is required/i)).toBeTruthy();
  });

  it("submits entered values plus materialized schema defaults", () => {
    renderForm();
    fillLabel();
    fireEvent.change(document.getElementById("i-scope-org")!, { target: { value: "acme" } });
    submit();
    expect(createMutate).toHaveBeenCalledOnce();
    const payload = createMutate.mock.calls[0]![0] as { scope: Record<string, unknown> };
    expect(payload.scope.org).toBe("acme");
    expect(payload.scope.includeForks).toBe(false);
    expect(payload.scope.includeOrganization).toBe(true);
    expect(payload.scope.billingPeriod).toBe("current");
    // untouched optional fields are absent — never submitted as ""
    expect("baseUrl" in payload.scope).toBe(false);
    expect("environmentMapping" in payload.scope).toBe(false);
  });

  it("renders a minimal field set for simple importers", () => {
    renderForm();
    pickImporter("Web URL");
    expect(document.getElementById("i-scope-url")).toBeTruthy();
    expect(document.getElementById("i-scope-org")).toBeNull();
  });

  it("edit mode pre-populates from stored scope, defaults for absent keys", () => {
    const config = {
      id: "c1",
      importerName: "github",
      label: "GH",
      scope: { org: "acme", includeForks: true },
      secretRefs: [],
      credentialIds: [],
      schedule: null,
      enabled: true,
      agentId: null,
      secretRefsDeprecated: false,
      agentIncompatible: false,
    };
    renderForm({ config });
    expect((document.getElementById("i-scope-org") as HTMLInputElement).value).toBe("acme");
    expect(
      (screen.getByRole("switch", { name: /include forks/i }) as HTMLElement).getAttribute(
        "data-state",
      ),
    ).toBe("checked");
    // absent stored key falls back to schema default
    expect(
      (screen.getByRole("switch", { name: /include organization/i }) as HTMLElement).getAttribute(
        "data-state",
      ),
    ).toBe("checked");
  });

  it("per-field JSON editor submits a parsed value", () => {
    renderForm();
    fillLabel();
    fireEvent.change(document.getElementById("i-scope-org")!, { target: { value: "acme" } });
    fireEvent.change(document.getElementById("i-scope-environmentMapping")!, {
      target: { value: '{"web": "PRODUCTION"}' },
    });
    submit();
    const payload = createMutate.mock.calls[0]![0] as { scope: Record<string, unknown> };
    expect(payload.scope.environmentMapping).toEqual({ web: "PRODUCTION" });
  });

  it("blocks submit on invalid per-field JSON, naming the field", () => {
    renderForm();
    fillLabel();
    fireEvent.change(document.getElementById("i-scope-org")!, { target: { value: "acme" } });
    fireEvent.change(document.getElementById("i-scope-environmentMapping")!, {
      target: { value: "{bad json" },
    });
    submit();
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/environment mapping.*valid json/i)).toBeTruthy();
    // non-object JSON (scalar/array) is also rejected — record fields need objects
    fireEvent.change(document.getElementById("i-scope-environmentMapping")!, {
      target: { value: "5" },
    });
    submit();
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/environment mapping.*valid json object/i)).toBeTruthy();
  });

  it("Edit as JSON round-trips values both directions", () => {
    renderForm();
    fillLabel();
    fireEvent.change(document.getElementById("i-scope-org")!, { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("button", { name: /edit as json/i }));
    const raw = document.getElementById("i-scope-json") as HTMLTextAreaElement;
    expect(JSON.parse(raw.value).org).toBe("acme");
    fireEvent.change(raw, { target: { value: '{"org": "changed", "legacyKey": 1}' } });
    fireEvent.click(screen.getByRole("button", { name: /edit fields/i }));
    expect((document.getElementById("i-scope-org") as HTMLInputElement).value).toBe("changed");
    // the unknown key moved to the unrecognized-fields block
    const unknown = document.getElementById("i-scope-unknown") as HTMLTextAreaElement;
    expect(JSON.parse(unknown.value)).toEqual({ legacyKey: 1 });
  });

  it("blocks submit on invalid raw JSON", () => {
    renderForm();
    fillLabel();
    fireEvent.click(screen.getByRole("button", { name: /edit as json/i }));
    fireEvent.change(document.getElementById("i-scope-json")!, {
      target: { value: "{nope" },
    });
    submit();
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/valid json/i)).toBeTruthy();
  });

  it("edit mode shows stored keys outside the schema in the unrecognized fields block and preserves them on save", () => {
    const config = {
      id: "c1",
      importerName: "github",
      label: "GH",
      scope: { org: "acme", legacyKey: "keep-me" },
      secretRefs: [],
      credentialIds: [],
      schedule: null,
      enabled: true,
      agentId: null,
      secretRefsDeprecated: false,
      agentIncompatible: false,
    };
    renderForm({ config });
    const unknown = document.getElementById("i-scope-unknown") as HTMLTextAreaElement;
    expect(unknown).toBeTruthy();
    expect(JSON.parse(unknown.value)).toEqual({ legacyKey: "keep-me" });
    submit();
    const payload = updateMutate.mock.calls[0]![0] as { scope: Record<string, unknown> };
    expect(payload.scope.legacyKey).toBe("keep-me");
    expect(payload.scope.org).toBe("acme");
  });

  it("switching importers resets scope to the new schema's defaults — no key leakage", () => {
    renderForm();
    fireEvent.change(document.getElementById("i-scope-org")!, { target: { value: "acme" } });
    pickImporter("Kubernetes");
    expect(document.getElementById("i-scope-org")).toBeNull();
    expect((document.getElementById("i-scope-namespace") as HTMLInputElement).value).toBe(
      "default",
    );
    fillLabel();
    submit();
    const payload = createMutate.mock.calls[0]![0] as {
      importerName: string;
      scope: Record<string, unknown>;
    };
    expect(payload.importerName).toBe("kubernetes");
    expect("org" in payload.scope).toBe(false);
    expect(payload.scope.namespace).toBe("default");
    expect(payload.scope.resourceTypes).toEqual(["apps/v1:Deployment"]);
  });

  it("maps server VALIDATION_FAILED scope paths to their fields (FR-009)", () => {
    const config = {
      id: "c1",
      importerName: "github",
      label: "GH",
      scope: { org: "acme" },
      secretRefs: [],
      credentialIds: [],
      schedule: null,
      enabled: true,
      agentId: null,
      secretRefsDeprecated: false,
      agentIncompatible: false,
    };
    updateMutate.mockImplementation((_args, opts) => {
      opts.onError({
        code: "VALIDATION_FAILED",
        message: "Scope validation failed",
        details: [
          { code: "invalid_type", path: ["org"], message: "expected non-empty string" },
          { code: "invalid_type", path: ["scope", "repos"], message: "expected array" },
        ],
      });
    });
    renderForm({ config });
    submit();
    expect(screen.getByText("expected non-empty string")).toBeTruthy();
    expect(screen.getByText("expected array")).toBeTruthy();
  });

  it("maps server unrecognized_keys errors to the Unrecognized-fields block (FR-005a)", () => {
    const config = {
      id: "c1",
      importerName: "github",
      label: "GH",
      scope: { org: "acme", legacyKey: "v" },
      secretRefs: [],
      credentialIds: [],
      schedule: null,
      enabled: true,
      agentId: null,
      secretRefsDeprecated: false,
      agentIncompatible: false,
    };
    updateMutate.mockImplementation((_args, opts) => {
      opts.onError({
        code: "VALIDATION_FAILED",
        message: "Scope validation failed",
        details: [
          {
            code: "unrecognized_keys",
            path: [],
            keys: ["legacyKey"],
            message: "Unrecognized key: legacyKey",
          },
        ],
      });
    });
    renderForm({ config });
    submit();
    expect(screen.getByText(/server rejected scope keys: legacyKey/i)).toBeTruthy();
  });

  it("a manifest refetch mid-edit does not wipe entered values", () => {
    const { rerender } = renderForm();
    fireEvent.change(document.getElementById("i-scope-org")!, { target: { value: "acme" } });
    rerender(
      <MemoryRouter>
        <TooltipProvider>
          <ImporterForm
            manifests={[...manifests] as never}
            credentials={[]}
            agents={[]}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect((document.getElementById("i-scope-org") as HTMLInputElement).value).toBe("acme");
  });
});
