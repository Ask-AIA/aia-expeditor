/**
 * Exhaustiveness helper for discriminated unions.
 * Call it in the `default` branch of a `switch` so the compiler rejects
 * unhandled variants.
 */
export function assertNever(value: never, message = 'Unhandled variant'): never {
  throw new Error(`${message}: ${String(value)}`);
}
