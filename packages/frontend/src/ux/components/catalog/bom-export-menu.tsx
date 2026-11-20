import * as React from "react"
import { DownloadIcon } from "lucide-react"
import { toast } from "sonner"
import { bomExportUrl } from "@/api/hooks/bom"
import { errorMessage } from "@/ux/lib/api-state"
import { Button } from "@/ux/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ux/components/ui/dropdown-menu"

type ExportFormat = "json" | "cyclonedx" | "spdx"

const FORMATS: { format: ExportFormat; label: string; audience: string }[] = [
  { format: "json", label: "Componode JSON", audience: "All fields, all scopes" },
  { format: "cyclonedx", label: "CycloneDX 1.5", audience: "For scanners and compliance tools" },
  { format: "spdx", label: "SPDX 2.3", audience: "For licence and procurement reviews" },
]

function filenameFromDisposition(header: string | null): string | null {
  const m = /filename="?([^";]+)"?/.exec(header ?? "")
  return m?.[1] ?? null
}

/**
 * UX-EXP — the BOM export menu. Downloads run through fetch+blob so the
 * live region can announce start/finish and failures surface as a toast
 * with retry (UX-EXP-05); the filename comes from Content-Disposition
 * (UX-EXP-04). Always exports the full BOM for the selected component or
 * instance — list filters never apply (UX-EXP-03).
 */
export function BomExportMenu({
  componentId,
  instanceId,
}: {
  componentId: string
  instanceId?: string
}) {
  const [announcement, setAnnouncement] = React.useState("")
  const [busy, setBusy] = React.useState<ExportFormat | null>(null)

  const download = async (format: ExportFormat) => {
    setBusy(format)
    setAnnouncement("Preparing export…")
    try {
      const res = await fetch(bomExportUrl(componentId, format, instanceId), {
        credentials: "include",
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? `Export failed (${res.status})`)
      }
      const filename = filenameFromDisposition(res.headers.get("Content-Disposition")) ?? "bom.json"
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      setAnnouncement(`Downloaded ${filename}`)
    } catch (e) {
      toast.error(errorMessage(e), {
        action: { label: "Retry", onClick: () => void download(format) },
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy !== null}>
            <DownloadIcon className="mr-2" aria-hidden />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel className="whitespace-normal text-xs font-normal text-muted-foreground">
            CycloneDX and SPDX can&apos;t express Build, Dev and Test scopes, so those
            are exported as Runtime or Optional.
          </DropdownMenuLabel>
          <DropdownMenuLabel className="whitespace-normal text-xs font-normal text-muted-foreground">
            Exports the complete inventory — list filters don&apos;t apply.
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {FORMATS.map(({ format, label, audience }) => (
            <DropdownMenuItem
              key={format}
              className="flex flex-col items-start gap-0.5"
              onSelect={() => void download(format)}
            >
              <span>{label}</span>
              <span className="text-xs text-muted-foreground">{audience}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
    </>
  )
}
