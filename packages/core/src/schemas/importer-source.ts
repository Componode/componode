import { z } from "zod";
import { IMPORTER_SOURCE_STATUSES } from "../constants/importer-source.js";

// ImporterSource list filters (spec 044, contracts/source-api.md).
export const importerSourceListQuerySchema = z
  .object({
    status: z.enum(IMPORTER_SOURCE_STATUSES).optional(),
    importerName: z.string().optional(),
  })
  .strict();

export type ImporterSourceListQuery = z.infer<
  typeof importerSourceListQuerySchema
>;
