// defineEnv() — validate + type the environment at the composition root
// (ADR-0043). Wraps our Zod schemas with @t3-oss/env-core's createEnv so:
//  - server secrets are typed server-only and can't reach the client bundle,
//  - PUBLIC_ client vars are the only ones exposed client-side,
//  - empty strings count as unset (defaults/required fire correctly),
//  - the Vercel preset adds typed VERCEL_* (env, url, git commit sha),
//  - misconfiguration fails fast with an aggregated error.
//
// Side-effect-free: nothing is validated until a consumer calls defineEnv().
// Tests pass a mock runtimeEnv; the server/adapters call defineEnv() once at boot.
import { createEnv } from '@t3-oss/env-core';
import { vercel } from '@t3-oss/env-core/presets-zod';
import { clientSchema, serverSchema } from './schema';

export function defineEnv(runtimeEnv: Record<string, string | undefined> = process.env) {
  return createEnv({
    extends: [vercel()],
    server: serverSchema,
    clientPrefix: 'PUBLIC_',
    client: clientSchema,
    runtimeEnv,
    emptyStringAsUndefined: true,
    onInvalidAccess: (key) => {
      throw new Error(`Attempted to access server-only env var "${key}" on the client.`);
    },
  });
}

export type Env = ReturnType<typeof defineEnv>;
