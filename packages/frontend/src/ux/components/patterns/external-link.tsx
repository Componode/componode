import type { AnchorHTMLAttributes } from "react";
import { safeUrl } from "@/ux/lib/safe-url";

interface ExternalLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

/**
 * External link with rel="noopener noreferrer" and safeUrl validation
 * (ADR-085). Renders nothing meaningful for non-http(s) hrefs.
 */
export function ExternalLink({ href, children, className, ...rest }: ExternalLinkProps) {
  const url = safeUrl(href);
  if (!url) return <span className={className}>{children}</span>;
  return (
    <a {...rest} href={url} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}
