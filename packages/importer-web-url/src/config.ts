import { urlSafetyError } from "@componode/core";
import { z } from "zod";

export const webUrlConfigSchema = z.object({
  url: z.string().url().superRefine((val, ctx) => {
    const reason = urlSafetyError(val);
    if (reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `URL is not allowed: ${reason}` });
    }
  }),
});

export type WebUrlConfig = z.infer<typeof webUrlConfigSchema>;
