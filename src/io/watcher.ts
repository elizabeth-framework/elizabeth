import { dlopen, FFIType, suffix, ptr } from "bun:ffi";
import { join } from "node:path";

const libPath = join(process.cwd(), "build", `libelizabeth_native.${suffix}`);

const lib = dlopen(libPath, {
  watcher_start: {
    args: [FFIType.cstring, FFIType.i32],
    returns: FFIType.ptr,
  },
  watcher_next_event: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  watcher_stop: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  watcher_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
});

const WATCH_EVENT_SIZE = 4096 + 256 + 4 * 5;

function readCStringFromBuffer(buf: ArrayBuffer, offset: number, maxLen: number) {
  const bytes = new Uint8Array(buf, offset, maxLen);
  const nul = bytes.indexOf(0);
  const end = nul === -1 ? maxLen : nul;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

function readI32(buf: ArrayBuffer, offset: number) {
  return new DataView(buf).getInt32(offset, true);
}

export function startWatcher(root: string, recursive = false) {
  const rootBuf = Buffer.from(root + "\0");

  const watcher = lib.symbols.watcher_start(ptr(rootBuf), recursive ? 1 : 0);
  if (!watcher) {
    throw new Error(`failed to start watcher: ${root}`);
  }

  return {
    next() {
      const evBuf = new ArrayBuffer(WATCH_EVENT_SIZE);
      const ok = lib.symbols.watcher_next_event(watcher, ptr(evBuf));

      if (ok !== 1) return null;

      return {
        path: readCStringFromBuffer(evBuf, 0, 4096),
        filename: readCStringFromBuffer(evBuf, 4096, 256),
        eventType: readI32(evBuf, 4352),
        exists: readI32(evBuf, 4356) === 1,
        isFile: readI32(evBuf, 4360) === 1,
        isDir: readI32(evBuf, 4364) === 1,
        kind: readI32(evBuf, 4368),
      };
    },

    stop() {
      lib.symbols.watcher_stop(watcher);
    },

    free() {
      lib.symbols.watcher_free(watcher);
    },
  };
}