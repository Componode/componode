import { assertCollectionUrlSafety, collectionScopeSchema } from "@componode/core";
import { z } from "zod";

// Web URL collection scope (spec 058, ADR-126): Component profiles with
// environment-specific ComponentInstances and one managed URL Check per
// instance. Web-endpoint checks carry no authentication — API-category
// auth rules apply only to api-url.
export const webUrlConfigSchema = collectionScopeSchema.superRefine((scope, ctx) => {
  assertCollectionUrlSafety(scope, (path, message) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path }),
  );
  for (const [ci, component] of scope.components.entries()) {
    for (const [ii, instance] of component.instances.entries()) {
      if (instance.check.authMode !== "NONE") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Web endpoint checks do not support authentication",
          path: ["components", ci, "instances", ii, "check", "authMode"],
        });
      }
    }
  }
});

export type WebUrlConfig = z.infer<typeof webUrlConfigSchema>;
