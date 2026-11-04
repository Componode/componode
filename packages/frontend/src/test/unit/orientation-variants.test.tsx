import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ux/components/ui/tabs";

const PRIMITIVE_FILES = [
  "src/ux/components/ui/button-group.tsx",
  "src/ux/components/ui/field.tsx",
  "src/ux/components/ui/scroll-area.tsx",
  "src/ux/components/ui/separator.tsx",
  "src/ux/components/ui/tabs.tsx",
  "src/ux/components/ui/toggle-group.tsx",
];

describe("Radix orientation variants", () => {
  it("uses data-orientation selectors in every affected primitive", () => {
    for (const file of PRIMITIVE_FILES) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("data-horizontal");
      expect(source, file).not.toContain("data-vertical");
    }
  });

  it("stacks horizontal Tabs content beneath the tab list", () => {
    render(
      <Tabs defaultValue="one" data-testid="tabs">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">Panel</TabsContent>
      </Tabs>,
    );

    const tabs = screen.getByTestId("tabs");
    expect(tabs.getAttribute("data-orientation")).toBe("horizontal");
    expect(tabs.className).toContain("data-[orientation=horizontal]:flex-col");
  });
});
