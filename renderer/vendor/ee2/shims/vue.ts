// [EE2-VENDOR SHIM] Minimal, pure stand-in for the `vue` package.
//
// The vendored trade files (price-check/trade/common.ts, RateLimiter.ts) and
// overlay/interfaces.ts import a handful of Vue reactivity primitives purely to
// power UI-facing reactive state (rate-limit stack display, etc.). None of that
// reactivity is needed for pure query construction, so we replace `vue` with these
// non-reactive plain-object equivalents. This lets the subtree bundle with esbuild
// WITHOUT pulling in the Vue runtime.
//
// The vendored files' `from "vue"` imports were repointed to this file — see the
// vendoring report for the exact list.

export interface Ref<T = unknown> {
  value: T;
}
export interface ComputedRef<T = unknown> {
  readonly value: T;
}

export function shallowRef<T>(value?: T): Ref<T> {
  return { value: value as T };
}
export const ref = shallowRef;

export function shallowReactive<T extends object>(target: T): T {
  return target;
}
export const reactive = shallowReactive;

export function readonly<T>(target: T): T {
  return target;
}

export function toRaw<T>(value: T): T {
  return value;
}

export function computed<T>(getter: () => T): ComputedRef<T> {
  return {
    get value() {
      return getter();
    },
  };
}

// no-op: nothing in the pure subtree observes changes
export function watch(): () => void {
  return () => {};
}
