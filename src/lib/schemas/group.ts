import { z } from "zod";
import { GROUP_DESCRIPTION_MAX, GROUP_ROLES } from "@/lib/validation/group";
import { nameSchema } from "./name";

export const groupInputSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(GROUP_DESCRIPTION_MAX),
});

export const invitationInputSchema = z.object({
  email: z.email(),
  role: z.enum(GROUP_ROLES),
});
