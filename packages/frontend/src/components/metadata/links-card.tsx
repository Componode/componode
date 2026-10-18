import { LinkIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink } from "@/components/external-link";
import { safeUrl } from "@/components/safe-url";
import type { Link } from "@/api/types";

/**
 * Renders curated reference links (spec 017, US1). Re-validates each URL with
 * safeUrl() at render time as defense in depth (ADR-085); unsafe entries are
 * rendered as plain text.
 */
export function LinksCard({ links }: { links: Link[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Links</CardTitle>
      </CardHeader>
      <CardContent>
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">No links.</p>
        ) : (
          <ul className="space-y-1.5" data-testid="links-list">
            {links.map((link, i) => {
              const url = safeUrl(link.url);
              return (
                <li key={`${link.title}-${i}`} className="flex items-center gap-2 text-sm">
                  <LinkIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  {url ? (
                    <ExternalLink href={url} className="text-primary hover:underline">
                      {link.title}
                    </ExternalLink>
                  ) : (
                    <span className="text-muted-foreground" title={link.url}>
                      {link.title}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
