// Public client API stubs.
// These are no-ops during server render and are recognized by the compiler
// when generating client island hydration code.

export function clientState<T>(
  initialValue: T,
): [T, (value: T | ((current: T) => T)) => void] {
  return [initialValue, () => {}];
}

export function onReady(callback: () => void | (() => void)): void {
  void callback;
}