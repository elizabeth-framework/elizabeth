export type ComponentVisibility = "declare" | "public" | "default" | "private";

export interface CompileResult {
  code: string;
  clientComponents: ClientComponent[];
}

export interface ClientComponent {
  name: string;
  exportName: string | null;
  events: ClientEvent[];
  states: ClientStateBinding[];
  textBindings: ClientTextBinding[];
  attrBindings: ClientAttributeBinding[];
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

export interface ClientTextBinding {
  id: number;
  expression: string;
}

export interface ClientAttributeBinding {
  id: number;
  name: string;
  expression: string;
  boolean: boolean;
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
