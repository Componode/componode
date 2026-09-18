import { z } from "zod";

export const updateSettingsSchema = z
  .object({
    allowSelfRegistration: z.boolean().optional(),
    sessionIdleTimeoutMs: z.number().int().min(60000).max(86400000).optional(),
    sessionAbsoluteTimeoutMs: z.number().int().min(300000).max(604800000).optional(),
    defaultUserRole: z.enum(["ADMIN", "EDITOR", "VIEWER"]).optional(),
  })
  .refine(
    (data) =>
      data.sessionIdleTimeoutMs === undefined ||
      data.sessionAbsoluteTimeoutMs === undefined ||
      data.sessionIdleTimeoutMs < data.sessionAbsoluteTimeoutMs,
    {
      message: "sessionIdleTimeoutMs must be less than sessionAbsoluteTimeoutMs",
      path: ["sessionIdleTimeoutMs"],
    },
  );

export const updateOidcConfigSchema = z.object({
  enabled: z.boolean(),
  issuer: z.string().url().optional().nullable(),
  clientId: z.string().optional().nullable(),
  clientSecretRef: z.string().optional().nullable(),
  // Credential-store reference for the client secret (spec 013 US7).
  // Preferred over the deprecated env `clientSecretRef`.
  clientSecretCredentialId: z.string().uuid().optional().nullable(),
  roleClaimPath: z.string().optional().nullable(),
  claimValueField: z.string().optional().nullable(),
  roleMapping: z.record(z.string(), z.enum(["ADMIN", "EDITOR", "VIEWER"])).optional().nullable(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type UpdateOidcConfigInput = z.infer<typeof updateOidcConfigSchema>;
