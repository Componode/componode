import { useState } from "react";
import { KeyRound, MoreHorizontal, Plus } from "lucide-react";
import { useCredentials, useCreateCredential } from "@/api/hooks/credentials";
import { CredentialForm } from "@/components/credential-form";
import { CredentialTestDialog } from "@/components/credential-test-dialog";
import {
  CredentialDetailDialog,
  DeleteCredentialDialog,
  RevokeCredentialDialog,
  RotateCredentialDialog,
} from "@/components/credential-lifecycle-dialogs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/states/skeletons";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Forbidden } from "@/components/states/forbidden";
import { StatusBadge } from "@/components/states/status-badge";
import { relativeTime, absoluteTime } from "@/lib/format";
import type { ApiError } from "@/api/client";
import type { Credential } from "@/api/types";

const EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1000;

export function CredentialsPage() {
  const { data, isPending, error, refetch } = useCredentials();
  const create = useCreateCredential();
  const [showForm, setShowForm] = useState(false);
  const [detailTarget, setDetailTarget] = useState<Credential | null>(null);
  const [testTarget, setTestTarget] = useState<Credential | null>(null);
  const [rotateTarget, setRotateTarget] = useState<Credential | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Credential | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Credential | null>(null);

  const credentials = data?.credentials ?? [];
  const isForbidden = error ? ((error as unknown) as ApiError).code === "FORBIDDEN" : false;
  const now = Date.now();

  return (
    <div className="bg-background p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Credentials</h1>
        {!showForm && (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="mr-1 h-4 w-4" /> New credential
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">New credential</CardTitle>
          </CardHeader>
          <CardContent>
            <CredentialForm
              submitting={create.isPending}
              onCancel={() => setShowForm(false)}
              onSubmit={async (input) => {
                await create.mutateAsync(input);
                setShowForm(false);
              }}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {isPending && credentials.length === 0 && <TableSkeleton />}

          {!isPending && isForbidden && <Forbidden />}

          {!isPending && !isForbidden && error && (
            <ErrorState error={error} onRetry={() => refetch()} />
          )}

          {!isPending && !error && credentials.length === 0 && (
            <EmptyState
              icon={KeyRound}
              title="No credentials"
              description="Store encrypted integration credentials (PATs, client secrets) for importers and OIDC."
            />
          )}

          {credentials.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Keys</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {credentials.map((cred) => {
                  const exp = cred.expiresAt ? Date.parse(cred.expiresAt) : null;
                  const expired = exp !== null && exp <= now;
                  const expiring = exp !== null && !expired && exp - now <= EXPIRY_WARNING_MS;
                  return (
                    <TableRow key={cred.id}>
                      <TableCell className="font-medium">{cred.label}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(cred.keyHints).map(([key, hint]) => (
                            <Badge key={key} variant="outline" className="font-mono text-xs">
                              {key} •••{hint}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={cred.status} />
                      </TableCell>
                      <TableCell>
                        {exp === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            {(expired || expiring) && (
                              <StatusBadge status={expired ? "EXPIRED" : "EXPIRING"} />
                            )}
                            <span
                              className="text-muted-foreground"
                              title={absoluteTime(cred.expiresAt!)}
                            >
                              {relativeTime(cred.expiresAt)}
                            </span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {cred.lastUsedAt ? relativeTime(cred.lastUsedAt) : "never"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {relativeTime(cred.createdAt)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Credential actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setDetailTarget(cred)}>
                              Details
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={cred.status !== "ACTIVE"}
                              onClick={() => setTestTarget(cred)}
                            >
                              Test
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={cred.status !== "ACTIVE"}
                              onClick={() => setRotateTarget(cred)}
                            >
                              Rotate
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={cred.status !== "ACTIVE"}
                              onClick={() => setRevokeTarget(cred)}
                            >
                              Revoke
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDeleteTarget(cred)}>
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CredentialDetailDialog
        credential={detailTarget}
        onClose={() => setDetailTarget(null)}
      />
      <CredentialTestDialog
        credential={testTarget}
        onClose={() => setTestTarget(null)}
      />
      <RotateCredentialDialog
        credential={rotateTarget}
        onClose={() => setRotateTarget(null)}
      />
      <RevokeCredentialDialog
        credential={revokeTarget}
        onClose={() => setRevokeTarget(null)}
      />
      <DeleteCredentialDialog
        credential={deleteTarget}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
