import { z } from "zod";
import { NAME_MAX } from "@/lib/validation/name";

// Person and group names: trimmed, never blank (spaces only), bounded below the varchar(191) column.
export const nameSchema = z.string().trim().min(1).max(NAME_MAX);
