import { LayersIcon, PlusIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { useComponentGroups } from "@/api/hooks/component-groups";
import { mapComponentGroup } from "@/api/mappers/catalog";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState } from "@/ux/components/patterns/states";
import { LifecycleBadge } from "@/ux/components/patterns/status-badge";
import { Button } from "@/ux/components/ui/button";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/ux/components/ui/card";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { errorMessage } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxComponentGroupsPage() {
  const { data, isPending, error, refetch } = useComponentGroups();

  return (
    <PageContainer>
      <PageHeader
        title="Component groups"
        description="Logical bundles of components that ship and retire together — useful when a product composes dozens of services."
        actions={
          <Button disabled title="Group creation isn't available yet">
            <PlusIcon data-icon="inline-start" />
            New group
          </Button>
        }
      />
      {isPending ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </ul>
      ) : error ? (
        <ErrorState
          title="Component groups unavailable"
          description={errorMessage(error)}
          onRetry={() => void refetch()}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.groups.map((g0) => {
            const g = mapComponentGroup(g0);
            return (
              <li key={g.id}>
                <Card className="relative h-full transition-colors hover:border-primary/40">
                  <CardHeader>
                    <span className="mb-2 flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
                      <LayersIcon className="size-4" aria-hidden="true" />
                    </span>
                    <CardTitle>
                      <Link to={ux(`/component-groups/${g.slug}`)} className="after:absolute after:inset-0 hover:underline">
                        {g.name}
                      </Link>
                    </CardTitle>
                    <CardDescription>{g.team ?? "No owning team"}</CardDescription>
                    <CardAction>
                      <LifecycleBadge value={g.lifecycle} />
                    </CardAction>
                  </CardHeader>
                  <CardFooter className="mt-auto justify-between text-sm text-muted-foreground">
                    <span className="tabular">{g.members} components</span>
                    <code className="font-mono text-xs">{g.slug}</code>
                  </CardFooter>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </PageContainer>
  );
}
