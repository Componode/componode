import { assertCollectionUrlSafety, collectionScopeSchema } from "@componode/core";
import { z } from "zod";

// API URL collection scope (spec 058, ADR-126): Component profiles with
// environment-specific ComponentInstances and one managed URL Check per
// instance. API-category checks may carry credential-backed authentication.
export const apiUrlConfigSchema = collectionScopeSchema.superRefine((scope, ctx) => {
  assertCollectionUrlSafety(scope, (path, message) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path }),
  );
});

export type ApiUrlConfig = z.infer<typeof apiUrlConfigSchema>;
