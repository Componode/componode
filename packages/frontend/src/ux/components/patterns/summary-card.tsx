import { Card, CardContent } from "@/ux/components/ui/card"

export function Summary({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="tabular text-2xl font-semibold">{value}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </CardContent>
    </Card>
  )
}
