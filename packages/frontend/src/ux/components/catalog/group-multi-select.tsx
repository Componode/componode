import { Checkbox } from "@/ux/components/ui/checkbox"
import { FieldDescription, FieldLabel } from "@/ux/components/ui/field"

/** Minimal group shape the picker needs — satisfied by both the API
 *  ComponentGroup and the view ComponentGroupView. */
export interface GroupPickerOption {
  id: string
  name: string
  members?: number
  memberCount?: number
  autoSourceId?: string | null
}

/**
 * Spec 070: multi-group picker for HUMAN-managed groups. Auto-managed
 * groups are system-owned — their memberships can't be set here (the API
 * rejects them), so they're filtered out of the options. Current auto
 * memberships render read-only underneath when provided.
 */
export function GroupMultiSelect({
  groups,
  value,
  onChange,
  autoMemberships = [],
  id = "group-multi",
}: {
  groups: GroupPickerOption[]
  value: string[]
  onChange: (ids: string[]) => void
  /** Read-only display of the component's auto-managed memberships. */
  autoMemberships?: { id: string; name: string }[]
  id?: string
}) {
  const humanGroups = groups.filter((g) => !g.autoSourceId)
  const selected = new Set(value)

  function toggle(groupId: string, checked: boolean) {
    onChange(checked ? [...value, groupId] : value.filter((v) => v !== groupId))
  }

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>Component groups</FieldLabel>
      {humanGroups.length === 0 ? (
        <FieldDescription>No groups yet — create one under Component groups.</FieldDescription>
      ) : (
        <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-md border border-border p-2">
          {humanGroups.map((g) => (
            <label
              key={g.id}
              htmlFor={`${id}-${g.id}`}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <Checkbox
                id={`${id}-${g.id}`}
                checked={selected.has(g.id)}
                onCheckedChange={(c) => toggle(g.id, c === true)}
              />
              <span>{g.name}</span>
              {((g.members ?? g.memberCount ?? 0) > 0) && (
                <span className="text-xs text-muted-foreground">
                  ({g.members ?? g.memberCount})
                </span>
              )}
            </label>
          ))}
        </div>
      )}
      {autoMemberships.length > 0 && (
        <FieldDescription>
          Auto-managed:{" "}
          {autoMemberships.map((g) => g.name).join(", ")}
          {" — maintained by importers, not editable here."}
        </FieldDescription>
      )}
    </div>
  )
}
