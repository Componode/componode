const ROLE_LEVEL = { VIEWER: 0, EDITOR: 1, ADMIN: 2 } as const;

/** Role gate for write-action visibility — `roleAtLeast(role)` means EDITOR+. */
export function roleAtLeast(
  role: string | undefined,
  min: keyof typeof ROLE_LEVEL = "EDITOR",
): boolean {
  return (ROLE_LEVEL[role as keyof typeof ROLE_LEVEL] ?? 0) >= ROLE_LEVEL[min];
}
