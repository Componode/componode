import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { render, cleanup, screen } from "@testing-library/react";
import { ExternalLink } from "@/ux/components/patterns/external-link";

afterEach(() => cleanup());

describe("ExternalLink", () => {
  it("renders an anchor with rel=noopener noreferrer and target=_blank", () => {
    const { container } = render(
      createElement(ExternalLink, { href: "https://example.com" }, "Example"),
    );
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchor?.getAttribute("target")).toBe("_blank");
  });

  it("renders its children and passes through props", () => {
    render(
      createElement(ExternalLink, { href: "https://example.com", "aria-label": "External" }, "Click"),
    );
    expect(screen.getByRole("link", { name: "External" })).toBeDefined();
  });

  it("does not render an anchor for non-http(s) hrefs (ADR-085)", () => {
    const { container } = render(
      createElement(ExternalLink, { href: "javascript:alert(1)" }, "x"),
    );
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("x")).toBeDefined();
  });
});
