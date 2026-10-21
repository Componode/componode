import { useEffect, useState } from "react";
import { Copy, Check, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExternalLink } from "@/components/external-link";
import type { AgentEnrollment } from "@/api/types";

interface Props {
  open: boolean;
  onClose: () => void;
  agentName: string;
  enrollment: AgentEnrollment | null;
}

// Show-once enrollment dialog (spec 025 US1): the token cannot be retrieved
// after this dialog closes. The hub URL is editable and prefilled from the
// browser origin (spec clarification).
export function AgentEnrollmentDialog({
  open,
  onClose,
  agentName,
  enrollment,
}: Props) {
  const [hubUrl, setHubUrl] = useState(() =>
    typeof window !== "undefined" ? window.location.origin : "",
  );
  const [copied, setCopied] = useState<"token" | "cmd" | null>(null);

  // The dialog stays mounted while closed — re-prefill from the origin each
  // time a new enrollment arrives so a second grant doesn't show a stale URL.
  useEffect(() => {
    if (enrollment && typeof window !== "undefined") {
      setHubUrl(window.location.origin);
      setCopied(null);
    }
  }, [enrollment]);

  if (!enrollment) return null;

  const installCmd = `docker run -d --name componode-agent-${agentName} \\
  -e HUB_URL=${hubUrl} \\
  -e AGENT_ENROLLMENT_TOKEN=${enrollment.token} \\
  -v componode-agent-${agentName}-state:/state \\
  -e AGENT_STATE_DIR=/state \\
  componode-agent:latest`;

  async function copy(text: string, which: "token" | "cmd") {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enroll agent &quot;{agentName}&quot;</DialogTitle>
          <DialogDescription>
            This enrollment token is shown <strong>once</strong>. Copy it now —
            it expires {new Date(enrollment.expiresAt).toLocaleString()} and is
            single-use.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agent-token">Enrollment token</Label>
            <div className="flex gap-2">
              <Input
                id="agent-token"
                readOnly
                value={enrollment.token}
                className="font-mono text-xs"
                onFocus={(e) => e.target.select()}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy token"
                onClick={() => copy(enrollment.token, "token")}
              >
                {copied === "token" ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="hub-url">Hub URL</Label>
            <Input
              id="hub-url"
              value={hubUrl}
              onChange={(e) => setHubUrl(e.target.value)}
              placeholder="https://componode.example.com"
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              The address the agent uses to reach this hub. Adjust it if the
              agent runs in a network that resolves the hub differently.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              <TerminalSquare className="h-4 w-4" /> Install command
            </Label>
            <div className="relative">
              <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">
                {installCmd}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="absolute right-2 top-2"
                onClick={() => copy(installCmd, "cmd")}
              >
                {copied === "cmd" ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              The token above is baked into this command — prefer mounting it
              via <code>AGENT_ENROLLMENT_TOKEN_FILE</code> in production. See
              the{" "}
              <ExternalLink
                href="https://github.com/Componode/componode/blob/main/docs/agents.md"
                className="text-primary hover:underline"
              >
                agent deployment guide
              </ExternalLink>
              .
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
