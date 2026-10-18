import { Link } from "react-router-dom";
import { Workflow } from "lucide-react";
import { usePlatformCandidates } from "@/api/hooks/components";
import { useSession } from "@/api/hooks/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { PlatformCandidate } from "@/api/types";

/**
 * ADR-017 worklist: components with direct DEPENDS_ON edges from ≥2 active
 * products. Rows link to the component and list each dependent product so
 * any role can inspect the blast radius; the Promote action is EDITOR+.
 */
export function PlatformCandidatesSection({
  onPromote,
}: {
  onPromote?: (candidate: PlatformCandidate) => void;
}) {
  const { data: candidates, isPending, error } = usePlatformCandidates();
  const { data: user } = useSession();
  const canEdit = ["EDITOR", "ADMIN"].includes(user?.role ?? "VIEWER");

  if (isPending || error || !candidates?.length) return null;

  return (
    <section aria-labelledby="platform-candidates-heading">
      <h2
        id="platform-candidates-heading"
        className="mb-3 flex items-center gap-2 text-lg font-semibold"
      >
        <Workflow className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        Platform candidates
      </h2>
      <Card>
        <CardContent className="divide-y p-0">
          {candidates.map((c) => (
            <div key={c.component.id} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-baseline gap-2 text-sm">
                  <Link
                    to={`/components/${c.component.id}`}
                    className="truncate font-medium hover:underline"
                  >
                    {c.component.name}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    depended on by {c.dependerCount} products
                  </span>
                </span>
                {canEdit && onPromote && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onPromote(c)}
                  >
                    Promote
                  </Button>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {c.dependents.map((d) => (
                  <Link
                    key={d.id}
                    to={`/products/${d.slug}`}
                    className="text-xs text-primary hover:underline"
                  >
                    {d.name}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
