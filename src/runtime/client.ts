export type IslandCleanup = () => void;
export type IslandHydrator = (root: Element) => void | IslandCleanup;

export const ELIZABETH_CLIENT_HOOKS = {
  state: {
    names: ["clientState"],
    memberName: "clientState",
  },
  ready: {
    names: ["clientReady", "onReady"],
    memberName: "clientReady",
  },
  memo: {
    names: ["clientMemo"],
    memberName: "clientMemo",
  },
  context: {
    names: ["clientContext"],
    memberName: "clientContext",
  },
  ref: {
    names: ["clientRef"],
    memberName: "clientRef",
  },
} as const;

export const ELIZABETH_CLIENT_STATE_HOOK_NAMES = new Set<string>(ELIZABETH_CLIENT_HOOKS.state.names);
export const ELIZABETH_CLIENT_STATE_MEMBER_NAME = ELIZABETH_CLIENT_HOOKS.state.memberName;
export const ELIZABETH_CLIENT_READY_HOOK_NAMES = new Set<string>(ELIZABETH_CLIENT_HOOKS.ready.names);
export const ELIZABETH_CLIENT_READY_MEMBER_NAME = ELIZABETH_CLIENT_HOOKS.ready.memberName;
export const ELIZABETH_CLIENT_MEMO_HOOK_NAMES = new Set<string>(ELIZABETH_CLIENT_HOOKS.memo.names);
export const ELIZABETH_CLIENT_MEMO_MEMBER_NAME = ELIZABETH_CLIENT_HOOKS.memo.memberName;
export const ELIZABETH_CLIENT_CONTEXT_HOOK_NAMES = new Set<string>(ELIZABETH_CLIENT_HOOKS.context.names);
export const ELIZABETH_CLIENT_CONTEXT_MEMBER_NAME = ELIZABETH_CLIENT_HOOKS.context.memberName;
export const ELIZABETH_CLIENT_REF_HOOK_NAMES = new Set<string>(ELIZABETH_CLIENT_HOOKS.ref.names);
export const ELIZABETH_CLIENT_REF_MEMBER_NAME = ELIZABETH_CLIENT_HOOKS.ref.memberName;

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
