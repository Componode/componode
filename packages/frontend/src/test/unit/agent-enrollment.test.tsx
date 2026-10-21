import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { AgentEnrollmentDialog } from "@/components/agent-enrollment-dialog";
import type { AgentEnrollment } from "@/api/types";

// Spec 025: the enrollment dialog is the ONLY place the token is ever shown;
// the hub URL is editable and prefilled from the browser origin.

const enrollment: AgentEnrollment = {
  token: "enroll-secret-123",
  expiresAt: "2030-01-01T00:00:00.000Z",
};

afterEach(cleanup);

describe("AgentEnrollmentDialog", () => {
  it("shows the token once with an explicit single-use warning", () => {
    render(
      <AgentEnrollmentDialog
        open
        onClose={() => {}}
        agentName="edge-agent"
        enrollment={enrollment}
      />,
    );
    expect(
      screen.getByText(
        (_content, el) =>
          el?.tagName === "P" &&
          /shown/i.test(el.textContent ?? "") &&
          /once/i.test(el.textContent ?? ""),
      ),
    ).toBeDefined();
    const input = screen.getByLabelText(
      /enrollment token/i,
    ) as HTMLInputElement;
    expect(input.value).toBe("enroll-secret-123");
    expect(input.readOnly).toBe(true);
  });

  it("renders nothing when enrollment material is absent (cannot re-display)", () => {
    const { container } = render(
      <AgentEnrollmentDialog
        open
        onClose={() => {}}
        agentName="edge-agent"
        enrollment={null}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("prefills the hub URL from the browser origin and lets it be edited", () => {
    render(
      <AgentEnrollmentDialog
        open
        onClose={() => {}}
        agentName="edge-agent"
        enrollment={enrollment}
      />,
    );
    const hub = screen.getByLabelText(/hub url/i) as HTMLInputElement;
    expect(hub.value).toBe(window.location.origin);

    fireEvent.change(hub, { target: { value: "https://hub.corp.internal" } });
    expect(hub.value).toBe("https://hub.corp.internal");
    // The edited URL flows into the install command.
    expect(
      screen.getByText(/HUB_URL=https:\/\/hub\.corp\.internal/),
    ).toBeDefined();
  });

  it("links to the agent deployment docs (FR-019)", () => {
    render(
      <AgentEnrollmentDialog
        open
        onClose={() => {}}
        agentName="edge-agent"
        enrollment={enrollment}
      />,
    );
    const link = screen.getByRole("link", { name: /deployment guide|agents/i });
    expect(link.getAttribute("href")).toContain("agents");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("bakes the token into the install command", () => {
    render(
      <AgentEnrollmentDialog
        open
        onClose={() => {}}
        agentName="edge-agent"
        enrollment={enrollment}
      />,
    );
    expect(
      screen.getByText(/AGENT_ENROLLMENT_TOKEN=enroll-secret-123/),
    ).toBeDefined();
  });
});
