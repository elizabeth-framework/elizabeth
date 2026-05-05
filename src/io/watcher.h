#pragma once

typedef struct Watcher Watcher;

typedef enum WatchEntryKind {
    WATCH_ENTRY_UNKNOWN = 0,
    WATCH_ENTRY_FILE = 1,
    WATCH_ENTRY_DIR = 2,
    WATCH_ENTRY_OTHER = 3
} WatchEntryKind;

typedef struct WatchEvent {
    char path[4096];
    char filename[256];

    int event_type; // raw libuv event: 1=rename/create/delete, 2=change

    int exists;
    int is_file;
    int is_dir;
    int kind;
} WatchEvent;

Watcher *watcher_start(const char *path, int recursive);

int watcher_next_event(Watcher *watcher, WatchEvent *out);

void watcher_stop(Watcher *watcher);

void watcher_free(Watcher *watcher);