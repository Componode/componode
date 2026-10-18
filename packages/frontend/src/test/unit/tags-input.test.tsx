import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { TagsInput, normalizeTag, isValidTag } from "@/components/metadata/tags-input";

afterEach(cleanup);

function Harness({ initial = [] as string[] }: { initial?: string[] }) {
  const [tags, setTags] = useState<string[]>(initial);
  return (
    <>
      <TagsInput value={tags} onChange={setTags} />
      <output data-testid="json">{JSON.stringify(tags)}</output>
    </>
  );
}

describe("normalizeTag / isValidTag (spec 017 US2)", () => {
  it("lowercases and trims", () => {
    expect(normalizeTag("  PCI ")).toBe("pci");
    expect(normalizeTag("PCI")).toBe("pci");
  });

  it("enforces the tag charset", () => {
    expect(isValidTag("pci")).toBe(true);
    expect(isValidTag("a.b_c:d-e")).toBe(true);
    expect(isValidTag("has space")).toBe(false);
    expect(isValidTag("-leading")).toBe(false);
    expect(isValidTag("x".repeat(33))).toBe(false);
  });
});

describe("TagsInput", () => {
  it("commits a normalized tag on Enter and dedupes", () => {
    render(<Harness initial={["pci"]} />);
    const input = screen.getByLabelText("Add tag");
    fireEvent.change(input, { target: { value: " BETA " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(JSON.parse(screen.getByTestId("json").textContent!)).toEqual(["pci", "beta"]);

    fireEvent.change(input, { target: { value: "pci" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(JSON.parse(screen.getByTestId("json").textContent!)).toEqual(["pci", "beta"]);
  });

  it("rejects invalid input with an alert", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Add tag");
    fireEvent.change(input, { target: { value: "has space" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("json").textContent!)).toEqual([]);
  });

  it("removes a tag via its chip button", () => {
    render(<Harness initial={["pci", "beta"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove tag pci" }));
    expect(JSON.parse(screen.getByTestId("json").textContent!)).toEqual(["beta"]);
  });
});
