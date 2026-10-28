import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { Switch } from "@/ux/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/ux/components/ui/radio-group";
import { Checkbox } from "@/ux/components/ui/checkbox";

const uiDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../ux/components/ui",
);

/**
 * F002 regression: Radix primitives emit `data-state="checked"` —
 * bare `data-checked:`/`data-unchecked:`/`data-on:`/`data-off:` variants
 * (and `has-data-checked:`) compile to `[data-checked]` selectors that never
 * match the DOM, so checked styling silently never applied.
 */
describe("control state variants (F002, bugfix 036)", () => {
  it("no ui component uses bare data-checked/unchecked/on/off variants", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(uiDir).filter((f) => f.endsWith(".tsx"))) {
      const src = readFileSync(join(uiDir, file), "utf-8");
      const bad = src.match(/data-(checked|unchecked|on|off):/g);
      if (bad) offenders.push(`${file}: ${bad.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("checked Switch emits data-state=checked and carries the state variant", () => {
    const { container } = render(<Switch checked onCheckedChange={() => {}} aria-label="t" />);
    const el = container.querySelector("[data-slot='switch']")!;
    expect(el.getAttribute("data-state")).toBe("checked");
    expect(el.className).toContain("data-[state=checked]:bg-primary");
  });

  it("checked RadioGroupItem emits data-state=checked with primary styling", () => {
    render(
      <RadioGroup value="a">
        <RadioGroupItem value="a" aria-label="r" />
      </RadioGroup>,
    );
    const el = screen.getByLabelText("r");
    expect(el.getAttribute("data-state")).toBe("checked");
    expect(el.className).toContain("data-[state=checked]:bg-primary");
  });

  it("checked Checkbox emits data-state=checked with primary styling", () => {
    render(<Checkbox checked onCheckedChange={() => {}} aria-label="c" />);
    const el = screen.getByLabelText("c");
    expect(el.getAttribute("data-state")).toBe("checked");
    expect(el.className).toContain("data-[state=checked]:bg-primary");
  });
});
