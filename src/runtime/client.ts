export type IslandHydrator = (root: Element) => void;

const registry = new Map<string, IslandHydrator>();

export function registerIsland(name: string, hydrate: IslandHydrator): void {
  registry.set(name, hydrate);
}

export function hydrateIsland(name: string, root: Element): void {
  const hydrate = registry.get(name);

  if (!hydrate) {
    return;
  }

  hydrate(root);
}

export function hydrateDocument(root: ParentNode = document): void {
  for (const element of root.querySelectorAll("[data-elizabeth-client]")) {
    hydrateIsland(element.getAttribute("data-elizabeth-client") ?? "", element);
  }
}
