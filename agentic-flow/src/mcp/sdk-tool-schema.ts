import { z } from 'zod';

/**
 * Keep `.describe()` text visible in tool schemas served through
 * `@anthropic-ai/claude-agent-sdk` 0.1.x.
 *
 * That SDK bundles its own copy of zod 4 core with a private metadata
 * registry. Zod 4 stores descriptions in a registry (not on the schema), so
 * the SDK's JSON Schema generator cannot see descriptions written by this
 * package's zod and every tool parameter loses its description. Zod's
 * generator consults `_zod.toJSONSchema` before anything else, so each
 * field's schema is rendered here, by the zod that owns the registry, and
 * pinned through that override on a detached clone (no `_zod.parent`, so the
 * generator never walks back to the described original). The caller's schemas
 * are not touched, and validation is unchanged: the clone shares the
 * original's definition, checks and defaults.
 *
 * Remove once the SDK shares zod's global registry (0.3.x does).
 */
export function withPortableDescriptions<T extends z.ZodRawShape>(shape: T): T {
  const portable: Record<string, z.core.$ZodType> = {};
  for (const [key, field] of Object.entries(shape)) {
    const json = z.toJSONSchema(field, { target: 'draft-7', io: 'input', unrepresentable: 'any' }) as Record<
      string,
      unknown
    >;
    delete json.$schema;
    const detached = z.core.clone(field);
    delete detached._zod.parent;
    detached._zod.toJSONSchema = () => json;
    portable[key] = detached;
  }
  return portable as unknown as T;
}
