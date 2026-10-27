import { z } from "zod/v4";

export const loginSchema = z.object({
  email: z.email("please enter a valid email"),
  password: z.string().min(4),
});

export const registerSchema = loginSchema.extend({
  name: z
    .string()
    .min(3, "name field should be at least 3 characters")
    .max(100, "name field should be at most 100 characters"),
});
