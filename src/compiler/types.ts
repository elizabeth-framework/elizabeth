export type ComponentVisibility = "declare" | "public" | "default" | "private";

export interface CompileResult {
  code: string;
  clientComponents: ClientComponent[];
}

export interface ClientComponent {
  name: string;
  exportName: string | null;
  clientFunctions: ClientFunction[];
  clientContexts: ClientContextBinding[];
  events: ClientEvent[];
  states: ClientStateBinding[];
  ready: ClientReadyHook[];
  memos: ClientMemoBinding[];
  refs: ClientRefBinding[];
  textBindings: ClientTextBinding[];
  htmlBindings: ClientHtmlBinding[];
  attrBindings: ClientAttributeBinding[];
}

export interface ClientFunction {
  name: string;
  source: string;
}

export interface ClientContextBinding {
  name: string;
  source: string;
}

export interface ClientEvent {
  id: number;
  eventName: string;
  handler: string;
}

export interface ClientStateBinding {
  name: string;
  setter: string;
  initialValue: string;
}

export interface ClientReadyHook {
  callback: string;
}

export interface ClientMemoBinding {
  id: number;
  name: string;
  callback: string;
  deps?: string;
}

export interface ClientRefBinding {
  id: number;
  name: string;
}

export interface ClientTextBinding {
  id: number;
  expression: string;
  reactive: boolean;
}

export interface ClientHtmlBinding {
  id: number;
  source: string;
  expression: string;
  reactive: boolean;
  events: ClientEvent[];
}

export interface ClientAttributeBinding {
  id: number;
  name: string;
  expression: string;
  boolean: boolean;
  reactive: boolean;
}

export interface ComponentProp {
  name: string;
  defaultValue: string | null;
}

export interface ComponentBlock {
  visibility: ComponentVisibility;
  client: boolean;
  name: string;
  props: ComponentProp[];
  body: string;
  sourceName: string;
  source: string;
  bodyStart: number;
}
