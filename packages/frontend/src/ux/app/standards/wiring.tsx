import { AlertTriangleIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { Badge } from "@/ux/components/ui/badge";
import { Button } from "@/ux/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table";
import { ux } from "@/ux/lib/paths";
import { WIRING, WIRING_RULES } from "@/ux/lib/wiring";

export function UxWiringPage() {
  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        title="Wiring guide"
        description="For every detail page: which fixture to replace, which endpoints to read, and which controls still need a mutation."
        actions={
          <Button variant="outline" asChild>
            <Link to={ux("/standards")}>UI standards</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Rules for all detail pages</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed">
            {WIRING_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {WIRING.map((w) => (
        <Card key={w.route} id={w.route}>
          <CardHeader>
            <CardTitle className="font-mono text-base">{w.route}</CardTitle>
            <CardDescription>
              <code className="font-mono text-xs">{w.file}</code> · param {w.param}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <dl className="grid gap-4 text-sm md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <dt className="font-medium">Replace fixture</dt>
                <dd className="text-muted-foreground">{w.fixture}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="font-medium">Reads</dt>
                <dd className="flex flex-col gap-1">
                  {w.read.map((r) => (
                    <code key={r} className="font-mono text-xs">
                      {r}
                    </code>
                  ))}
                </dd>
              </div>
            </dl>
            {w.tabs && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">Tabs</span>
                {w.tabs.map((t) => (
                  <Badge key={t} variant="secondary" className="font-mono">
                    ?tab={t}
                  </Badge>
                ))}
              </div>
            )}
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-4">Control</TableHead>
                    <TableHead>Call</TableHead>
                    <TableHead className="pr-4">Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {w.mutations.map((m) => (
                    <TableRow key={m.control}>
                      <TableCell className="pl-4 text-sm font-medium">{m.control}</TableCell>
                      <TableCell className="font-mono text-xs">{m.call}</TableCell>
                      <TableCell className="pr-4 text-sm text-muted-foreground">{m.note ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {w.gap && (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                <span>{w.gap}</span>
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </PageContainer>
  );
}
