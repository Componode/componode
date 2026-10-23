
import { AlertTriangleIcon, FileUpIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useNavigate } from "react-router-dom"
import * as React from "react"
import { toast } from "sonner"
import { FormSection } from "@/ux/components/forms/form-shell"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Button } from "@/ux/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { Spinner } from "@/ux/components/ui/spinner"
import { ux } from "@/ux/lib/paths"

interface Report {
  created: number
  updated: number
  edgesAdded: number
  skipped: { name: string; reason: string }[]
}

const MAX_BYTES = 1024 * 1024

/**
 * Catalog bootstrap (dry run, then apply). The prototype derives a report from the file
 * size; the real flow posts the file with dryRun=true, shows the report, then posts again to apply.
 */
export function ImportProducts() {
  const navigate = useNavigate()
  const [file, setFile] = React.useState<File | null>(null)
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<Report | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [applying, setApplying] = React.useState(false)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.files?.[0] ?? null
    setPreview(null)
    setFileError(null)
    setFile(null)
    if (!next) return
    if (!/\.(ya?ml|json)$/i.test(next.name)) {
      setFileError("Use a .yaml, .yml or .json file.")
      return
    }
    if (next.size === 0) {
      setFileError("The file is empty.")
      return
    }
    if (next.size > MAX_BYTES) {
      setFileError("The file is larger than 1 MB.")
      return
    }
    setFile(next)
    setPreviewing(true)
    setTimeout(() => {
      const total = Math.max(2, Math.min(40, Math.round(next.size / 180)))
      const skipped = total > 4 ? [{ name: "legacy-billing", reason: "Missing required field: name" }] : []
      setPreview({
        created: Math.ceil((total - skipped.length) / 2),
        updated: Math.floor((total - skipped.length) / 2),
        edgesAdded: total * 2,
        skipped,
      })
      setPreviewing(false)
    }, 700)
  }

  function apply() {
    setApplying(true)
    setTimeout(() => {
      toast.success("Catalog imported (simulated)")
      navigate("/products")
    }, 800)
  }

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="Import products"
        description="Upload a YAML or JSON catalog. Products are created or updated by name-derived slug and wired to matching components."
      />
      <FormSection title="Catalog file" description="Selecting a file runs a dry run. Nothing is saved until you apply.">
        <Field data-invalid={fileError ? true : undefined}>
          <FieldLabel htmlFor="catalog-file">File</FieldLabel>
          <Input id="catalog-file" type="file" accept=".yaml,.yml,.json" onChange={onFile} aria-invalid={fileError ? true : undefined} />
          <FieldDescription>Up to 1 MB. Re-uploading the same file is safe: existing products are updated, not duplicated.</FieldDescription>
          {fileError && <p className="text-sm text-destructive">{fileError}</p>}
        </Field>
        {previewing && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Spinner /> Checking {file?.name}…
          </p>
        )}
        {preview && file && (
          <div className="flex flex-col gap-3" role="status">
            <p className="text-sm font-medium">Dry run for {file.name}</p>
            <p className="text-sm">
              {preview.created} to create, {preview.updated} to update, {preview.edgesAdded} dependency links to add
              {preview.skipped.length > 0 && `, ${preview.skipped.length} skipped`}.
            </p>
            {preview.skipped.length > 0 && (
              <Alert>
                <AlertTriangleIcon />
                <AlertTitle>Skipped entries</AlertTitle>
                <AlertDescription>
                  <ul className="flex flex-col gap-1">
                    {preview.skipped.map((s) => (
                      <li key={s.name}>
                        <span className="font-mono text-xs">{s.name}</span>: {s.reason}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </FormSection>
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" asChild>
          <Link to={ux("/products")}>Cancel</Link>
        </Button>
        <Button onClick={apply} disabled={!preview || applying}>
          {applying ? <Spinner data-icon="inline-start" /> : <FileUpIcon data-icon="inline-start" />}
          Apply import
        </Button>
      </div>
    </PageContainer>
  )
}
