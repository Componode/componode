import { ArrowRightIcon, CheckIcon, SparklesIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { useAcceptSuggestion, useDismissSuggestion } from "@/api/hooks/suggestions"
import { EmptyState } from "@/ux/components/patterns/states"
import { StatusBadge } from "@/ux/components/patterns/status-badge"
import { Badge } from "@/ux/components/ui/badge"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent } from "@/ux/components/ui/card"
import type { Suggestion } from "@/ux/lib/view-types"
import { errorMessage } from "@/ux/lib/api-state"

const CONFIDENCE = {
  HIGH: { tone: "success", label: "High confidence" },
  MEDIUM: { tone: "warning", label: "Medium confidence" },
  LOW: { tone: "neutral", label: "Low confidence" },
} as const

const KIND_LABEL: Record<Suggestion["kind"], string> = {
  COMPOSES: "composes",
  DEPENDS_ON: "depends on",
  CONSUMES_FROM: "consumes from",
}

/**
 * Review-queue pattern: one decision per row, accept/dismiss are both one
 * click. Decisions are terminal (ADR-113) — there is no undo.
 */
export function SuggestionQueue({ items }: { items: Suggestion[] }) {
  const accept = useAcceptSuggestion()
  const dismiss = useDismissSuggestion()
  const pending = accept.isPending || dismiss.isPending

  const decide = (s: Suggestion, accepted: boolean) => {
    const mutation = accepted ? accept : dismiss
    mutation.mutate(s.id, {
      onSuccess: () =>
        toast(accepted ? "Relationship added" : "Suggestion dismissed", {
          description: `${s.from} ${KIND_LABEL[s.kind]} ${s.to}`,
        }),
      onError: (e) => toast.error(errorMessage(e)),
    })
  }

  if (items.length === 0) {
    return <EmptyState icon={SparklesIcon} title="You're all caught up" description="New suggestions appear after each import run." />
  }

  return (
    <ul className="flex flex-col gap-3">
      {items.map((s) => (
        <li key={s.id}>
          <Card className="py-4">
            <CardContent className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{s.from}</span>
                  <Badge variant="outline" className="font-mono">
                    {KIND_LABEL[s.kind]}
                    <ArrowRightIcon />
                  </Badge>
                  <span className="font-medium">{s.to}</span>
                </p>
                <p className="text-sm text-muted-foreground">{s.reason}</p>
              </div>
              <StatusBadge {...CONFIDENCE[s.confidence]} />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={pending} onClick={() => decide(s, false)}>
                  <XIcon data-icon="inline-start" />
                  Dismiss
                </Button>
                <Button size="sm" disabled={pending} onClick={() => decide(s, true)}>
                  <CheckIcon data-icon="inline-start" />
                  Accept
                </Button>
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  )
}
