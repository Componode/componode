import { Link } from "react-router-dom";
import { PlusIcon } from "lucide-react";
import { useDockerTargets } from "@/api/hooks/docker-targets";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { StatusBadge } from "@/ux/components/patterns/status-badge";
import { Button } from "@/ux/components/ui/button";
import { Card } from "@/ux/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table";
import { errorMessage } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxDockerTargetsPage() {
  const targets = useDockerTargets();
  return (
    <PageContainer>
      <PageHeader
        title="Docker targets"
        description="Hub-managed Docker Engine access routes. Profiles hold no secret values — transports reference credential keys."
        actions={
          <Button asChild>
            <Link to={ux("/docker-targets/new")}>
              <PlusIcon data-icon="inline-start" />
              New target
            </Link>
          </Button>
        }
      />
      {targets.isPending ? (
        <Card className="py-0"><TableSkeleton rows={5} columns={5} /></Card>
      ) : targets.error ? (
        <ErrorState description={errorMessage(targets.error)} onRetry={() => void targets.refetch()} />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-4">Label</TableHead>
                <TableHead>Target ID</TableHead>
                <TableHead>Transport</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {targets.data.targets.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="pl-4 font-medium">
                    <Link to={ux(`/docker-targets/${t.id}`)} className="hover:underline">{t.label}</Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.targetId}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{String(t.profile.transport)}</TableCell>
                  <TableCell><StatusBadge tone={t.enabled ? "success" : "warning"} label={t.enabled ? "Enabled" : "Disabled"} /></TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={ux(`/docker-targets/${t.id}`)}>Manage</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {targets.data.targets.length === 0 && (
                <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">No Docker targets yet. Create one to run the Docker importer on the Hub.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </PageContainer>
  );
}
