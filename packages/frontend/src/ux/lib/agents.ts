const AGENT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

/** Mirrors the hub rule: lowercase letters, digits and hyphens, 3–40 chars, unique per workspace. */
export function validateAgentName(name: string, existing: string[]): string | null {
  if (!name) return "Name is required"
  if (!AGENT_NAME_PATTERN.test(name)) return "Use 3–40 lowercase letters, digits or hyphens"
  if (existing.includes(name)) return "An agent with this name already exists"
  return null
}

export const ENROLLMENT_TTL_HOURS = 24
