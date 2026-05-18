// Public client API stubs.
// These are no-ops during server render and are recognized by the compiler
// when generating client island hydration code.

export function clientState<T>(
  initialValue: T,
): [T, (value: T | ((current: T) => T)) => void] {
  return [initialValue, () => {}];
}

export function clientReady(callback: () => void | (() => void)): void {
  void callback;
}

export const onReady = clientReady;

export function clientMemo<T>(callback: () => T, _deps?: readonly unknown[]): T {
  return callback();
}

export interface ClientContext<T> {
  use(): T;
  provide<R>(value: T, render: () => R): R;
}

export function clientContext<T>(defaultValue: T): ClientContext<T> {
  const stack: T[] = [];

  return {
    use() {
      return stack.length > 0 ? stack[stack.length - 1] : defaultValue;
    },
    provide<R>(value: T, render: () => R): R {
      stack.push(value);
      try {
        const result = render();
        if (result && typeof (result as unknown as Promise<unknown>).then === "function") {
          return (result as unknown as Promise<unknown>).finally(() => {
            stack.pop();
          }) as R;
        }
        stack.pop();
        return result;
      } catch (error) {
        stack.pop();
        throw error;
      }
    },
  };
}

export interface ClientRef<T extends Element = Element> {
  current: T | null;
}

export function clientRef<T extends Element = Element>(): ClientRef<T> {
  return { current: null };
}
