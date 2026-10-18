import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { LinksEditor } from "@/components/metadata/links-editor";
import { LinksCard } from "@/components/metadata/links-card";
import type { Link } from "@/api/types";

afterEach(cleanup);

function Harness({ initial = [] as Link[] }: { initial?: Link[] }) {
  const [links, setLinks] = useState<Link[]>(initial);
  return (
    <>
      <LinksEditor value={links} onChange={setLinks} />
      <output data-testid="count">{links.length}</output>
      <output data-testid="json">{JSON.stringify(links)}</output>
    </>
  );
}

describe("LinksEditor (spec 017 US1)", () => {
  it("adds, edits, and removes rows preserving order", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /add link/i }));
    fireEvent.click(screen.getByRole("button", { name: /add link/i }));
    expect(screen.getByTestId("count").textContent).toBe("2");

    fireEvent.change(screen.getByLabelText("link-title-0"), { target: { value: "Runbook" } });
    fireEvent.change(screen.getByLabelText("link-url-0"), { target: { value: "https://run.example" } });
    fireEvent.change(screen.getByLabelText("link-title-1"), { target: { value: "Repo" } });

    fireEvent.click(screen.getByRole("button", { name: "Remove link 1" }));
    const links = JSON.parse(screen.getByTestId("json").textContent!);
    expect(links).toEqual([{ title: "Repo", url: "" }]);
  });

  it("caps at 20 links and disables add", () => {
    const full = Array.from({ length: 20 }, (_, i) => ({ title: `l${i}`, url: `https://${i}.x` }));
    render(<Harness initial={full} />);
    expect((screen.getByRole("button", { name: /add link/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("LinksCard (spec 017 US1)", () => {
  it("renders links in order as safe external anchors", () => {
    render(
      <LinksCard
        links={[
          { title: "Runbook", url: "https://run.example" },
          { title: "Docs", url: "https://docs.example" },
        ]}
      />,
    );
    const anchors = screen.getAllByRole("link");
    expect(anchors.map((a) => a.textContent)).toEqual(["Runbook", "Docs"]);
    expect(anchors[0]!.getAttribute("href")).toBe("https://run.example");
    expect(anchors[0]!.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders unsafe URLs as plain text, not anchors (ADR-085)", () => {
    render(<LinksCard links={[{ title: "Evil", url: "javascript:alert(1)" }]} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Evil")).toBeTruthy();
  });
});
