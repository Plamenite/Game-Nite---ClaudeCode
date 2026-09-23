/**
 * Features the iPhone's JavaScript engine (Hermes) does not have, but
 * libraries we use expect. Imported FIRST, before anything else loads.
 *
 * FinalizationRegistry: @colyseus/schema creates one when it loads, as a
 * server-side safety net for cleaning up "views". The phone never creates
 * views, so a registry that does nothing is safe here.
 *
 * WeakRef: Hermes has it today; the stand-in only covers older engines.
 */
// Plain record: the engine may lack these, whatever the type definitions say.
const g = globalThis as unknown as Record<string, unknown>;

if (typeof g.FinalizationRegistry === 'undefined') {
  class NoopFinalizationRegistry {
    constructor(_cleanup: (heldValue: unknown) => void) {}
    register(_target: object, _heldValue: unknown, _unregisterToken?: object): void {}
    unregister(_unregisterToken: object): boolean {
      return false;
    }
  }
  g.FinalizationRegistry = NoopFinalizationRegistry;
}

if (typeof g.WeakRef === 'undefined') {
  class StrongRef<T extends object> {
    readonly target: T;
    constructor(target: T) {
      this.target = target;
    }
    deref(): T | undefined {
      return this.target;
    }
  }
  g.WeakRef = StrongRef;
}

export {};
