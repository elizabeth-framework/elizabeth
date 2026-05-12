import { ProjectCache } from "./cache";
import { scanProjectSrc } from "./scan";

export type ProjectContext = {
  root: string;
  cache: ProjectCache;
  close: () => Promise<void>;
};

export async function createProjectContext(root: string): Promise<ProjectContext> {
  const cache = new ProjectCache();

  await scanProjectSrc(root, cache);

  return {
    root,
    cache,
    async close() {},
  };
}
