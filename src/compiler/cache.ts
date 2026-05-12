// src/compiler/cache.ts
export type PathMeta = {
  path: string;
  name: string;
  parent: string | null;

  isFile: boolean;
  isDir: boolean;

  files: Set<string>;
  dirs: Set<string>;

  version: number;
};

export class ProjectCache {
  paths = new Map<string, PathMeta>();
  pendingUnknown = new Set<string>();

  private version = 0;

  get revision(): number {
    return this.version;
  }

  addDir(path: string, parent: string | null) {
    const meta = this.paths.get(path);

    if (meta) {
      meta.isDir = true;
      meta.isFile = false;
      meta.version = ++this.version;
      return meta;
    }

    const created: PathMeta = {
      path,
      name: this.basename(path),
      parent,
      isFile: false,
      isDir: true,
      files: new Set(),
      dirs: new Set(),
      version: ++this.version,
    };

    this.paths.set(path, created);

    if (parent) {
      this.paths.get(parent)?.dirs.add(path);
    }

    return created;
  }

  addFile(path: string, parent: string) {
    const meta = this.paths.get(path);

    if (meta) {
      meta.isFile = true;
      meta.isDir = false;
      meta.version = ++this.version;
    } else {
      this.paths.set(path, {
        path,
        name: this.basename(path),
        parent,
        isFile: true,
        isDir: false,
        files: new Set(),
        dirs: new Set(),
        version: ++this.version,
      });
    }

    this.paths.get(parent)?.files.add(path);
    this.pendingUnknown.delete(path);
  }

  removePath(path: string) {
    const meta = this.paths.get(path);

    if (meta?.parent) {
      const parent = this.paths.get(meta.parent);
      parent?.files.delete(path);
      parent?.dirs.delete(path);
    }

    this.paths.delete(path);
    this.pendingUnknown.delete(path);
  }

  markChanged(path: string) {
    const meta = this.paths.get(path);

    if (meta) {
      meta.version = ++this.version;
    } else {
      this.pendingUnknown.add(path);
    }
  }

  markUnknown(path: string) {
    if (!this.paths.has(path)) {
      this.pendingUnknown.add(path);
    }
  }

  get(path: string) {
    return this.paths.get(path);
  }

  has(path: string) {
    return this.paths.has(path);
  }

  private basename(path: string) {
    const i = path.lastIndexOf("/");
    return i === -1 ? path : path.slice(i + 1);
  }
}
