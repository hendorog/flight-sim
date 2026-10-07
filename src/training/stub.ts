// Wave-0 placeholders. The contract stubs (spec section 6.3, "Wave 0") let the seven module implementers
// compile against each other's signatures before the bodies exist. Each implementer deletes the uses in
// the files they own; when no file imports this module any more, it is deleted too.

/** Thrown by every stubbed function or method body. */
export function notImplemented(what: string): never {
  throw new Error(`${what}: not implemented (Flight School wave-0 stub)`);
}

/**
 * A placeholder for an exported constant (a table, a lesson list, an aircraft profile). Importing it is
 * harmless; touching any property throws, so a test can never pass vacuously against an empty table.
 * `then` reads undefined so dynamic imports and awaits do not trip over it.
 */
export function pendingValue<T extends object>(what: string): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      return notImplemented(`${what}.${String(prop)}`);
    },
    has() {
      return notImplemented(what);
    },
    ownKeys() {
      return notImplemented(what);
    },
  });
}
