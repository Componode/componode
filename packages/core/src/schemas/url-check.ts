import { z } from "zod";
import {
  URL_CHECK_AUTH_MODES,
  URL_CHECK_MAX_CADENCE_SECONDS,
  URL_CHECK_METHODS,
  URL_CHECK_MIN_CADENCE_SECONDS,
  URL_CHECK_WINDOWS,
  URL_CHECK_VANTAGES,
  URL_CHECK_WINDOW_PARAMS,
} from "../constants/url-check.js";
import { ENVIRONMENTS } from "../constants/environments.js";

const enumOf = <T extends readonly string[]>(values: T) =>
  z.enum(values as unknown as [string, ...string[]]);

const cadenceSeconds = z
  .number()
  .int()
  .min(URL_CHECK_MIN_CADENCE_SECONDS)
  .max(URL_CHECK_MAX_CADENCE_SECONDS);

const statusCode = z.number().int().min(100).max(599);

// Accepted statuses: explicit codes and/or inclusive ranges. At least one
// matcher required; validated against successPolicySchema.
export const successPolicySchema = z
  .object({
    codes: z.array(statusCode).default([]),
    ranges: z
      .array(
        z
          .object({ min: statusCode, max: statusCode })
          .strict()
          .refine((r) => r.min <= r.max, "Range min must be <= max"),
      )
      .default([]),
  })
  .strict()
  .refine((p) => p.codes.length + p.ranges.length >= 1, {
    message: "Success policy must accept at least one status",
  });

// HTTP header field-name charset (RFC 9110 token) — Authorization is
// reserved for the BASIC/BEARER modes (ADR-123 item 7) and rejected here.
const headerName = z
  .string()
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/, "Invalid header name")
  .refine((n) => n.toLowerCase() !== "authorization", {
    message: "Authorization is reserved for Basic/Bearer auth modes",
  });

const credentialKey = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/, "Invalid credential key name");

export const authConfigSchema = z.union([
  z.object({ usernameKey: credentialKey, passwordKey: credentialKey }).strict(),
  z.object({ tokenKey: credentialKey }).strict(),
  z
    .object({
      headers: z
        .array(z.object({ name: headerName, key: credentialKey }).strict())
        .min(1),
    })
    .strict(),
]);

export const updateMonitoringSetupSchema = z
  .object({
    cadenceSeconds: cadenceSeconds.optional(),
    vantage: enumOf(URL_CHECK_VANTAGES).optional(),
    agentId: z.string().uuid().nullable().optional(),
  })
  .strict();

const urlCheckFields = {
  name: z.string().min(1, "Name is required").max(120),
  url: z.string().min(1).max(2048),
  componentInstanceId: z.string().uuid(),
  method: enumOf(URL_CHECK_METHODS).default("GET"),
  enabled: z.boolean().default(true),
  cadenceSeconds: cadenceSeconds.nullable().optional(),
  successPolicy: successPolicySchema.optional(),
  availabilityTarget: z.number().min(0).max(100).nullable().optional(),
  targetWindow: enumOf(URL_CHECK_WINDOWS).nullable().optional(),
  authMode: enumOf(URL_CHECK_AUTH_MODES).default("NONE"),
  credentialId: z.string().uuid().nullable().optional(),
  authConfig: authConfigSchema.nullable().optional(),
};

const urlCheckRefines = <T extends { availabilityTarget?: unknown; targetWindow?: unknown; authMode?: unknown; credentialId?: unknown; authConfig?: unknown }>(
  schema: z.ZodType<T>,
) =>
  schema
    .refine(
      (v) =>
        (v.availabilityTarget == null && v.targetWindow == null) ||
        (v.availabilityTarget != null && v.targetWindow != null),
      {
        message:
          "availabilityTarget and targetWindow must be set together or both omitted",
      },
    )
    .refine((v) => v.authMode === "NONE" || v.credentialId != null, {
      message: "credentialId is required when authMode is not NONE",
    })
    .refine((v) => v.authMode !== "NONE" || v.authConfig == null, {
      message: "authConfig is only allowed with an auth mode",
    });

const createUrlCheckObjectSchema = z.object(urlCheckFields).strict();

export const createUrlCheckSchema = urlCheckRefines(createUrlCheckObjectSchema);

// Never .partial() a schema with .default() fields — Zod 4 injects defaults
// into PATCH bodies. Re-declare optional fields explicitly.
export const updateUrlCheckSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    url: z.string().min(1).max(2048).optional(),
    componentInstanceId: z.string().uuid().optional(),
    method: enumOf(URL_CHECK_METHODS).optional(),
    enabled: z.boolean().optional(),
    cadenceSeconds: cadenceSeconds.nullable().optional(),
    successPolicy: successPolicySchema.nullable().optional(),
    availabilityTarget: z.number().min(0).max(100).nullable().optional(),
    targetWindow: enumOf(URL_CHECK_WINDOWS).nullable().optional(),
    authMode: enumOf(URL_CHECK_AUTH_MODES).optional(),
    credentialId: z.string().uuid().nullable().optional(),
    authConfig: authConfigSchema.nullable().optional(),
  })
  .strict()
  // Same pairing rule as create: a PATCH may set both or clear both
  // together — a single-sided change would hit the CHECK constraint.
  .refine(
    (v) =>
      (v.availabilityTarget == null && v.targetWindow == null) ||
      (v.availabilityTarget != null && v.targetWindow != null),
    {
      message:
        "availabilityTarget and targetWindow must be set together or both omitted",
    },
  );

export const urlCheckMetricsQuerySchema = z
  .object({
    window: enumOf(URL_CHECK_WINDOW_PARAMS).default("24h"),
  })
  .strict();

export const urlCheckObservationsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

// Composite create (US5): optional instance + monitoring blocks on
// createComponentSchema. `monitoring` requires `instance` (service-level
// check — schema only declares shapes).
export const createInstanceBlockSchema = z
  .object({
    environment: enumOf(ENVIRONMENTS),
    url: z.string().min(1).max(2048).optional(),
    version: z.string().max(100).optional(),
    region: z.string().max(100).optional(),
  })
  .strict();

export const createMonitoringBlockSchema = z
  .object({
    setup: z
      .object({
        cadenceSeconds: cadenceSeconds.optional(),
        vantage: enumOf(URL_CHECK_VANTAGES).optional(),
        agentId: z.string().uuid().nullable().optional(),
      })
      .strict()
      .optional(),
    checks: z
      .array(
        // checks in the composite target the new instance, so
        // componentInstanceId is not part of the client payload.
        urlCheckRefines(
          createUrlCheckObjectSchema.omit({ componentInstanceId: true }),
        ),
      )
      .min(1),
  })
  .strict();

export type UpdateMonitoringSetupInput = z.infer<typeof updateMonitoringSetupSchema>;
export type CreateUrlCheckInput = z.infer<typeof createUrlCheckSchema>;
export type UpdateUrlCheckInput = z.infer<typeof updateUrlCheckSchema>;
export type UrlCheckMetricsQuery = z.infer<typeof urlCheckMetricsQuerySchema>;
export type UrlCheckObservationsQuery = z.infer<typeof urlCheckObservationsQuerySchema>;
export type CreateInstanceBlock = z.infer<typeof createInstanceBlockSchema>;
export type CreateMonitoringBlock = z.infer<typeof createMonitoringBlockSchema>;
