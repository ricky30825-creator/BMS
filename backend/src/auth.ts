import { betterAuth } from "better-auth";
import { db } from "./db.js";
import { corsOrigins, env } from "./config/env.js";

const googleProvider =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET
        }
      }
    : undefined;

export const auth = betterAuth({
  database: db,
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: corsOrigins,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      // Wire this to the project email provider before production.
      console.info("password reset requested", { email: user.email, url });
    }
  },
  socialProviders: googleProvider
});

export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
