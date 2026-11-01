import { describe, it, expect } from "vitest";
import { parseAgentMessage } from "../../src/contracts/agent-protocol.js";
import { AGENT_PROTOCOL_VERSION } from "../../src/constants/import-agent.js";

// Protocol v5 (spec 052): the url_check.probe.cancel frame joins the
// payload-correlated probe family — probeId in the payload, no runId.

const PROBE_ID = "018c5e60-0000-7000-8000-0000000000aa";

describe("url_check.probe.cancel frame", () => {
  it("parses a well-formed cancel frame", () => {
    const msg = parseAgentMessage({
      type: "url_check.probe.cancel",
      payload: { probeId: PROBE_ID },
    });
    expect(msg.type).toBe("url_check.probe.cancel");
    expect(msg.payload).toEqual({ probeId: PROBE_ID });
    expect(msg.runId).toBeUndefined();
  });

  it("rejects a cancel frame with a non-uuid probeId", () => {
    expect(() =>
      parseAgentMessage({
        type: "url_check.probe.cancel",
        payload: { probeId: "not-a-uuid" },
      }),
    ).toThrow();
  });

  it("rejects a cancel frame missing the payload probeId", () => {
    expect(() =>
      parseAgentMessage({ type: "url_check.probe.cancel", payload: {} }),
    ).toThrow();
  });

  it("rejects unknown payload fields (strict schema)", () => {
    expect(() =>
      parseAgentMessage({
        type: "url_check.probe.cancel",
        payload: { probeId: PROBE_ID, extra: true },
      }),
    ).toThrow();
  });
});

describe("probe frame family still parses (regression)", () => {
  it("accepts url_check.probe and url_check.probe.result", () => {
    const probe = parseAgentMessage({
      type: "url_check.probe",
      payload: {
        probeId: PROBE_ID,
        url: "https://api.example.test/health",
        method: "GET",
        timeoutMs: 5000,
        authMode: "NONE",
      },
    });
    expect(probe.type).toBe("url_check.probe");

    const result = parseAgentMessage({
      type: "url_check.probe.result",
      payload: { probeId: PROBE_ID, outcome: "FAILURE", errorType: "SATURATED" },
    });
    expect(result.type).toBe("url_check.probe.result");
    expect(
      (result.payload as { errorType?: string }).errorType,
    ).toBe("SATURATED");
  });
});

describe("protocol version", () => {
  it("is 5 (url_check.probe.cancel + SATURATED)", () => {
    expect(AGENT_PROTOCOL_VERSION).toBe(5);
  });
});
