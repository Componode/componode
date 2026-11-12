import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { ComponentDetail } from "@/ux/components/catalog/component-detail";
import { GithubDetailsSection } from "@/ux/components/catalog/github-details";
import type { Component, ComponentInstance } from "@/ux/lib/view-types";

// spec 072 — bounded allowlist rendering for github:repository details
// (ADR-121): named sections only, no generic details dump.
vi.mock("@/ux/components/catalog/component-edit-dialog", () => ({
  ComponentEditDialog: () => null,
}));
vi.mock("@/ux/components/catalog/instance-environment-dialog", () => ({
  InstanceEnvironmentDialog: () => null,
}));
vi.mock("@/ux/components/catalog/url-checks-card", () => ({
  UrlChecksCard: () => null,
  OutcomeDots: () => null,
}));

const wrap = (el: React.ReactElement) =>
  render(
    <MemoryRouter>
      <TooltipProvider>{el}</TooltipProvider>
    </MemoryRouter>,
  );

const wrapSection = (el: React.ReactElement) =>
  render(<TooltipProvider>{el}</TooltipProvider>);

function instance(
  rawConfig: ComponentInstance["rawConfig"],
  over: Partial<ComponentInstance> = {},
): ComponentInstance {
  return {
    id: "i1",
    environment: "PRODUCTION",
    reportedEnvironment: "PRODUCTION",
    environmentOverride: null,
    environmentOverriddenBy: null,
    environmentOverriddenAt: null,
    region: null,
    status: "RUNNING",
    version: null,
    url: null,
    externalId: "github:repo:1:env:production",
    lastSeenAt: "2026-11-01T00:00:00Z",
    rawConfig,
    ...over,
  };
}

function component(
  instances: ComponentInstance[],
  over: Partial<Component> = {},
): Component {
  return {
    id: "c1",
    name: "acme/widgets",
    slug: "acme-widgets",
    category: "REPOSITORY",
    provider: "GITHUB",
    resourceType: "github:repository",
    lifecycle: "ACTIVE",
    componentGroups: [],
    teamOwnerId: null,
    teamOwnerName: null,
    tags: [],
    sunsetAt: null,
    links: [],
    instanceCount: instances.length,
    instances,
    lastSeenAt: null,
    worstStatus: "RUNNING",
    details: null,
    ...over,
  };
}

const BRANCHES = [
  {
    name: "main",
    sha: "abc1234def5678901234567890abcdef12345678",
    url: "https://github.com/acme/widgets/tree/main",
    protected: true,
    isDefault: true,
    lastActivityAt: "2026-01-02T00:00:00Z",
  },
  {
    name: "develop",
    sha: "def5678901234567890abcdef1234567890abcde",
    url: "https://github.com/acme/widgets/tree/develop",
    protected: false,
    isDefault: false,
  },
  {
    name: "dependabot/npm_and_yarn",
    sha: "999888777666555444333222111000aaaabbbbcc",
    url: "https://github.com/acme/widgets/tree/dependabot/npm_and_yarn",
    protected: false,
    isDefault: false,
    lastActivityAt: "2026-01-01T00:00:00Z",
  },
];

const RELEASES = [
  {
    id: 7200,
    tagName: "v1.2.3",
    name: "v1.2.3",
    publishedAt: "2026-01-03T00:00:00Z",
    prerelease: false,
    draft: false,
    targetCommitish: "main",
    assetCount: 2,
    assetsTotalBytes: 4096,
    htmlUrl: "https://github.com/acme/widgets/releases/tag/v1.2.3",
  },
  {
    id: 7300,
    tagName: "v1.3.0-rc.1",
    name: null,
    publishedAt: null,
    prerelease: true,
    draft: true,
    targetCommitish: "develop",
    assetCount: 0,
    assetsTotalBytes: 0,
    htmlUrl: "https://github.com/acme/widgets/releases/tag/v1.3.0-rc.1",
  },
];

const TAGS = [
  {
    name: "nightly",
    sha: "aaa1111bbb2222ccc3333ddd4444eee5555ffff66",
    htmlUrl: "https://github.com/acme/widgets/releases/tag/nightly",
  },
];

const FULL_DETAILS = {
  language: "TypeScript",
  topics: ["dpam", "catalog"],
  visibility: "private",
  htmlUrl: "https://github.com/acme/widgets",
  defaultBranch: "main",
  archived: false,
  disabled: false,
  fork: true,
  forkParent: {
    fullName: "acme/widgets-upstream",
    htmlUrl: "https://github.com/acme/widgets-upstream",
  },
  forkSource: {
    fullName: "acme/widgets-origin",
    htmlUrl: "https://github.com/acme/widgets-origin",
  },
  sizeKb: 2048,
  license: { key: "mit", name: "MIT License", spdxId: "MIT" },
  openIssuesCount: 12,
  createdAt: "2024-01-01T00:00:00Z",
  pushedAt: "2026-01-02T00:00:00Z",
  updatedAt: "2026-01-03T00:00:00Z",
  branches: BRANCHES,
  releases: RELEASES,
  tags: TAGS,
  languages: { TypeScript: 91234, "Shell Script": 1024 },
  capabilities: {
    branches: { status: "OK" },
    versionInventory: { status: "FORBIDDEN", message: "token lacks access" },
  },
};

afterEach(cleanup);

describe("GithubDetailsSection — repository facts (spec 072)", () => {
  it("renders repo facts from allowlisted details keys", () => {
    wrapSection(<GithubDetailsSection details={FULL_DETAILS} />);
    expect(screen.getByText("Repository")).toBeTruthy();
    expect(screen.getByText("Default branch")).toBeTruthy();
    // "main" also appears as a branch link and release target — assert presence
    expect(screen.getAllByText("main").length).toBeGreaterThan(0);
    expect(screen.getByText("Fork")).toBeTruthy();
    expect(screen.getByText("Fork parent")).toBeTruthy();
    expect(screen.getByText("Fork source")).toBeTruthy();
    expect(screen.getByText("acme/widgets-upstream")).toBeTruthy();
    expect(screen.getByText("acme/widgets-origin")).toBeTruthy();
    expect(screen.getByText("Size")).toBeTruthy();
    expect(screen.getByText("2.0 MiB")).toBeTruthy(); // 2048 KiB formatted
    expect(screen.getByText("License")).toBeTruthy();
    expect(screen.getByText("MIT License")).toBeTruthy();
    expect(screen.getByText("Open issues")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("Language")).toBeTruthy();
    expect(screen.getByText("private")).toBeTruthy(); // visibility
    // timestamps render as <time dateTime=...>
    expect(
      document.querySelector('time[dateTime="2024-01-01T00:00:00Z"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('time[dateTime="2026-01-02T00:00:00Z"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('time[dateTime="2026-01-03T00:00:00Z"]'),
    ).toBeTruthy();
  });

  it("renders fork provenance and repo htmlUrl as safe external links", () => {
    wrapSection(<GithubDetailsSection details={FULL_DETAILS} />);
    const parent = screen.getByRole("link", {
      name: "acme/widgets-upstream",
    });
    expect(parent.getAttribute("href")).toBe(
      "https://github.com/acme/widgets-upstream",
    );
    expect(parent.getAttribute("rel")).toContain("noopener");
    const repo = screen.getByRole("link", {
      name: "https://github.com/acme/widgets",
    });
    expect(repo.getAttribute("href")).toBe("https://github.com/acme/widgets");
  });

  it("omits flag rows that are false and facts that are absent", () => {
    wrapSection(
      <GithubDetailsSection
        details={{ defaultBranch: "trunk", archived: false, fork: false }}
      />,
    );
    expect(screen.getByText("Default branch")).toBeTruthy();
    expect(screen.getByText("trunk")).toBeTruthy();
    expect(screen.queryByText("Archived")).toBeNull();
    expect(screen.queryByText("Disabled")).toBeNull();
    expect(screen.queryByText("Fork parent")).toBeNull();
    expect(screen.queryByText("License")).toBeNull();
  });

  it("returns null when details carry no allowlisted github keys", () => {
    const { container } = wrapSection(
      <GithubDetailsSection details={{ composeProject: "web" }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("GithubDetailsSection — branch inventory (spec 072 US1)", () => {
  it("renders every branch with badges, short sha, activity and link", () => {
    wrapSection(<GithubDetailsSection details={FULL_DETAILS} />);
    expect(screen.getByText("Branches")).toBeTruthy();
    // every branch name renders — including non-environment branches
    // ("main"/"develop" also appear as fact values and release targets)
    expect(screen.getAllByText("main").length).toBeGreaterThan(0);
    expect(screen.getAllByText("develop").length).toBeGreaterThan(0);
    expect(screen.getByText("dependabot/npm_and_yarn")).toBeTruthy();
    // default + protected badges on main only
    expect(screen.getByText("default")).toBeTruthy();
    expect(screen.getByText("protected")).toBeTruthy();
    // short sha rendered, full sha never
    expect(screen.getByText("abc1234")).toBeTruthy();
    expect(
      screen.queryByText("abc1234def5678901234567890abcdef12345678"),
    ).toBeNull();
    // branch links point at the GitHub tree URL
    const mainLink = screen.getByRole("link", { name: "main" });
    expect(mainLink.getAttribute("href")).toBe(
      "https://github.com/acme/widgets/tree/main",
    );
    // last-activity timestamps render as machine time
    expect(
      document.querySelector('time[dateTime="2026-01-02T00:00:00Z"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('time[dateTime="2026-01-01T00:00:00Z"]'),
    ).toBeTruthy();
  });

  it("omits the branches section entirely when the toggle left the key absent", () => {
    const detailsNoBranches = Object.fromEntries(
      Object.entries(FULL_DETAILS).filter(([k]) => k !== "branches"),
    );
    wrapSection(<GithubDetailsSection details={detailsNoBranches} />);
    expect(screen.queryByText("Branches")).toBeNull();
    // branch-only names are gone ("develop" still appears as a release
    // targetCommitish — that is expected)
    expect(screen.queryByText("dependabot/npm_and_yarn")).toBeNull();
    expect(screen.queryByText("abc1234")).toBeNull();
    // sibling sections still render
    expect(screen.getByText("Releases")).toBeTruthy();
  });

  it("renders an empty-inventory branches key as no table but keeps other sections", () => {
    wrapSection(<GithubDetailsSection details={{ ...FULL_DETAILS, branches: [] }} />);
    expect(screen.queryByText("Branches")).toBeNull();
    expect(screen.getByText("Releases")).toBeTruthy();
  });
});

describe("GithubDetailsSection — version inventory (spec 072 US2)", () => {
  it("renders releases with flags, target, asset summary and links", () => {
    wrapSection(<GithubDetailsSection details={FULL_DETAILS} />);
    expect(screen.getByText("Releases")).toBeTruthy();
    expect(screen.getByText("v1.2.3")).toBeTruthy();
    expect(screen.getByText("v1.3.0-rc.1")).toBeTruthy();
    // prerelease + draft badges on the rc
    expect(screen.getByText("prerelease")).toBeTruthy();
    expect(screen.getByText("draft")).toBeTruthy();
    // target commitish + asset summary ("main"/"develop" also render as
    // branch names and the default-branch fact)
    expect(screen.getAllByText("main").length).toBeGreaterThan(0);
    expect(screen.getAllByText("develop").length).toBeGreaterThan(0);
    expect(screen.getByText(/2 assets/)).toBeTruthy();
    expect(screen.getByText(/4\.0 KiB/)).toBeTruthy();
    // release links
    const rel = screen.getByRole("link", { name: "v1.2.3" });
    expect(rel.getAttribute("href")).toBe(
      "https://github.com/acme/widgets/releases/tag/v1.2.3",
    );
    // published timestamp as machine time
    expect(
      document.querySelector('time[dateTime="2026-01-03T00:00:00Z"]'),
    ).toBeTruthy();
  });

  it("renders plain tags with sha and link", () => {
    wrapSection(<GithubDetailsSection details={FULL_DETAILS} />);
    expect(screen.getByText("Tags")).toBeTruthy();
    expect(screen.getByText("nightly")).toBeTruthy();
    expect(screen.getByText("aaa1111")).toBeTruthy();
    const tag = screen.getByRole("link", { name: "nightly" });
    expect(tag.getAttribute("href")).toBe(
      "https://github.com/acme/widgets/releases/tag/nightly",
    );
  });
});

describe("GithubDetailsSection — languages & capabilities (spec 072 US3)", () => {
  it("renders the per-language byte breakdown formatted", () => {
    wrapSection(<GithubDetailsSection details={FULL_DETAILS} />);
    expect(screen.getByText("Languages")).toBeTruthy();
    expect(screen.getByText("89 KiB")).toBeTruthy(); // 91234 bytes
    expect(screen.getByText("1.0 KiB")).toBeTruthy(); // 1024 bytes
  });

  it("notes degraded capability families and hides OK ones", () => {
    wrapSection(<GithubDetailsSection details={FULL_DETAILS} />);
    expect(
      screen.getByText(/Some GitHub inventory data is incomplete/i),
    ).toBeTruthy();
    expect(screen.getByText(/Version inventory/)).toBeTruthy();
    expect(screen.getByText(/FORBIDDEN/)).toBeTruthy();
    expect(screen.getByText(/token lacks access/)).toBeTruthy();
    // branches capability is OK — its label must not appear in the notice
    expect(screen.queryByText(/Branch inventory/)).toBeNull();
  });

  it("renders no notice when every capability is OK", () => {
    wrapSection(
      <GithubDetailsSection
        details={{
          ...FULL_DETAILS,
          capabilities: { branches: { status: "OK" } },
        }}
      />,
    );
    expect(
      screen.queryByText(/Some GitHub inventory data is incomplete/i),
    ).toBeNull();
  });
});

describe("GithubDetailsSection — allowlist & URL safety (ADR-121/ADR-085)", () => {
  it("never renders unknown details keys", () => {
    wrapSection(
      <GithubDetailsSection
        details={{
          ...FULL_DETAILS,
          apiToken: "SECRET-TOKEN",
          branches: [
            {
              name: "main",
              sha: "abc1234",
              url: "https://github.com/acme/widgets/tree/main",
              protected: true,
              isDefault: true,
              internalNote: "SECRET-BRANCH",
            },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/SECRET-TOKEN/)).toBeNull();
    expect(screen.queryByText(/SECRET-BRANCH/)).toBeNull();
    expect(screen.queryByText("apiToken")).toBeNull();
    expect(screen.queryByText("internalNote")).toBeNull();
  });

  it("does not turn unsafe branch URLs into links", () => {
    wrapSection(
      <GithubDetailsSection
        details={{
          defaultBranch: "main",
          branches: [
            {
              name: "evil-branch",
              sha: "abc1234",
              url: "javascript:alert(1)",
              protected: false,
              isDefault: false,
            },
          ],
        }}
      />,
    );
    // name still renders as text, but no anchor carries the unsafe href
    expect(screen.getByText("evil-branch")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "evil-branch" })).toBeNull();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});

describe("component detail wiring (spec 072)", () => {
  it("renders the GitHub section on a github:repository component", () => {
    const c = component([], { details: FULL_DETAILS });
    wrap(<ComponentDetail component={c} />);
    expect(screen.getByText("Branches")).toBeTruthy();
    expect(screen.getByText("Releases")).toBeTruthy();
    expect(screen.getByText("Tags")).toBeTruthy();
    expect(screen.getByText("Languages")).toBeTruthy();
    expect(screen.getByText("Repository")).toBeTruthy();
  });

  it("does not render the GitHub section for other resource types", () => {
    const c = component([], {
      resourceType: "compose-service",
      provider: "DOCKER",
      details: FULL_DETAILS,
    });
    wrap(<ComponentDetail component={c} />);
    expect(screen.queryByText("Branches")).toBeNull();
    expect(screen.queryByText("Releases")).toBeNull();
    expect(screen.queryByText("Languages")).toBeNull();
    expect(screen.queryByText("develop")).toBeNull();
  });

  it("renders the GitHub section even when the component has instances", () => {
    const c = component(
      [
        instance(
          {
            environment: "production",
            deploymentState: "success",
          },
          { environment: "PRODUCTION" },
        ),
      ],
      { details: { defaultBranch: "main", branches: BRANCHES } },
    );
    wrap(<ComponentDetail component={c} />);
    expect(screen.getByText("Branches")).toBeTruthy();
    expect(screen.getByText("develop")).toBeTruthy();
  });
});
