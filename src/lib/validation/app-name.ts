import { z } from "zod";

// Keeps the sidebar title within two lines.
export const APP_NAME_MAX = 40;

export const appNameSchema = z.string().trim().min(1).max(APP_NAME_MAX);
