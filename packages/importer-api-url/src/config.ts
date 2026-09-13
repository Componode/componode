import { urlSafetyError } from "@componode/core";
import { z } from "zod";

export const apiUrlConfigSchema = z.object({
  url: z.string().url().superRefine((val, ctx) => {
    const reason = urlSafetyError(val);
    if (reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `URL is not allowed: ${reason}` });
    }
  }),
});

export type ApiUrlConfig = z.infer<typeof apiUrlConfigSchema>;
