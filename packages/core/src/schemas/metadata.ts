import { z } from "zod";

const httpUrlSchema = z
  .string()
  .url("Link URL must be a valid URL")
  .refine((v) => /^https?:\/\//i.test(v), {
    message: "Link URL must be http or https",
  });

/** A titled external reference attached to a product or component (ADR-111). */
export const linkSchema = z
  .object({
    title: z.string().min(1, "Link title is required").max(80),
    url: httpUrlSchema,
  })
  .strict();

export const linksSchema = z
  .array(linkSchema)
  .max(20, "At most 20 links are allowed");

export type Link = z.infer<typeof linkSchema>;

const tagPattern = /^[a-z0-9][a-z0-9._:-]{0,31}$/;

/** Tags are normalized at write: trimmed, lowercased, then validated. */
export const tagSchema = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(
    z
      .string()
      .regex(
        tagPattern,
        "Tags must start with a lowercase letter or digit and contain only lowercase letters, digits, '.', '_', ':', '-' (max 32 chars)",
      ),
  );

export const tagsSchema = z
  .array(tagSchema)
  .max(20, "At most 20 tags are allowed")
  .transform((arr) => [...new Set(arr)]);
