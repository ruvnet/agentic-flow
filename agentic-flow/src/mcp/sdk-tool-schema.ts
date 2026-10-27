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
 * pinned through that override. Validation is untouched: arguments are still
 * parsed by the zod schemas themselves.
 *
 * Remove once the SDK shares zod's global registry (0.3.x does).
 */
export function withPortableDescriptions<T extends z.ZodRawShape>(shape: T): T {
  for (const field of Object.values(shape)) {
    const json = z.toJSONSchema(field, { target: 'draft-7', io: 'input', unrepresentable: 'any' }) as Record<
      string,
      unknown
    >;
    delete json.$schema;
    field._zod.toJSONSchema = () => json;
  }
  return shape;
}
