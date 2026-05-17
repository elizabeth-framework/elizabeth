export type IslandCleanup = () => void;
export type IslandHydrator = (root: Element) => void | IslandCleanup;

export const ELIZABETH_CLIENT_HOOKS = {
  state: {
    names: ["clientState"],
    memberName: "clientState",
  },
  ready: {
    names: ["onReady"],
    memberName: "onReady",
  },
} as const;

export const ELIZABETH_CLIENT_STATE_HOOK_NAMES = new Set<string>(ELIZABETH_CLIENT_HOOKS.state.names);
export const ELIZABETH_CLIENT_STATE_MEMBER_NAME = ELIZABETH_CLIENT_HOOKS.state.memberName;
export const ELIZABETH_CLIENT_READY_HOOK_NAMES = new Set<string>(ELIZABETH_CLIENT_HOOKS.ready.names);
export const ELIZABETH_CLIENT_READY_MEMBER_NAME = ELIZABETH_CLIENT_HOOKS.ready.memberName;

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
