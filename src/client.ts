export function clientState<T>(initialValue: T): [T, (value: T | ((current: T) => T)) => void] {
  return [initialValue, () => {}];
}
