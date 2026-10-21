import { z } from "zod";
import { APP_NAME_MAX } from "@/lib/validation/app-name";

export const appNameSchema = z.string().trim().min(1).max(APP_NAME_MAX);
