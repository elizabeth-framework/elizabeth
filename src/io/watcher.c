#include "io/watcher.h"

#include <uv.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

typedef struct EventNode {
    WatchEvent event;
    struct EventNode *next;
} EventNode;

struct Watcher {
    uv_loop_t loop;
    uv_fs_event_t fs_event;
    uv_async_t stop_async;
    uv_thread_t thread;

    uv_mutex_t mutex;

    EventNode *head;
    EventNode *tail;

    char root[4096];

    int closed;
};

static void fill_event_metadata(WatchEvent *event) {
    struct stat st;

    event->exists = 0;
    event->is_file = 0;
    event->is_dir = 0;
    event->kind = WATCH_ENTRY_UNKNOWN;

    if (lstat(event->path, &st) != 0) {
        return;
    }

    event->exists = 1;

    if (S_ISREG(st.st_mode)) {
        event->is_file = 1;
        event->kind = WATCH_ENTRY_FILE;
    } else if (S_ISDIR(st.st_mode)) {
        event->is_dir = 1;
        event->kind = WATCH_ENTRY_DIR;
    } else {
        event->kind = WATCH_ENTRY_OTHER;
    }
}

static void copy_str(char *dst, size_t dst_size, const char *src) {
    if (!dst || dst_size == 0) return;

    if (!src) {
        dst[0] = '\0';
        return;
    }

    snprintf(dst, dst_size, "%s", src);
}

static void join_event_path(char *out, size_t out_size, const char *root, const char *filename) {
    if (!filename || filename[0] == '\0') {
        copy_str(out, out_size, root);
        return;
    }

    size_t root_len = strlen(root);

    if (root_len > 0 && root[root_len - 1] == '/') {
        snprintf(out, out_size, "%s%s", root, filename);
    } else {
        snprintf(out, out_size, "%s/%s", root, filename);
    }
}

static void push_event(Watcher *watcher, const char *filename, int events) {
    EventNode *node = calloc(1, sizeof *node);
    if (!node) return;

    copy_str(node->event.filename, sizeof node->event.filename, filename);
    join_event_path(node->event.path, sizeof node->event.path, watcher->root, filename);

    node->event.event_type = events;

    if (events >= 0) {
        fill_event_metadata(&node->event);
    }

    uv_mutex_lock(&watcher->mutex);

    if (watcher->tail) {
        watcher->tail->next = node;
        watcher->tail = node;
    } else {
        watcher->head = node;
        watcher->tail = node;
    }

    uv_mutex_unlock(&watcher->mutex);
}

static void on_fs_event(
    uv_fs_event_t *handle,
    const char *filename,
    int events,
    int status
) {
    Watcher *watcher = handle->data;

    if (status < 0) {
        push_event(watcher, NULL, status);
        return;
    }

    push_event(watcher, filename, events);
}

static void on_stop_async(uv_async_t *handle) {
    Watcher *watcher = handle->data;

    if (watcher->closed) return;
    watcher->closed = 1;

    uv_fs_event_stop(&watcher->fs_event);

    uv_close((uv_handle_t *)&watcher->fs_event, NULL);
    uv_close((uv_handle_t *)&watcher->stop_async, NULL);
}

static void watcher_thread_main(void *arg) {
    Watcher *watcher = arg;
    uv_run(&watcher->loop, UV_RUN_DEFAULT);
}

Watcher *watcher_start(const char *path, int recursive) {
    Watcher *watcher = calloc(1, sizeof *watcher);
    if (!watcher) return NULL;

    copy_str(watcher->root, sizeof watcher->root, path);

    if (uv_mutex_init(&watcher->mutex) != 0) {
        free(watcher);
        return NULL;
    }

    if (uv_loop_init(&watcher->loop) != 0) {
        uv_mutex_destroy(&watcher->mutex);
        free(watcher);
        return NULL;
    }

    if (uv_fs_event_init(&watcher->loop, &watcher->fs_event) != 0) {
        uv_loop_close(&watcher->loop);
        uv_mutex_destroy(&watcher->mutex);
        free(watcher);
        return NULL;
    }

    if (uv_async_init(&watcher->loop, &watcher->stop_async, on_stop_async) != 0) {
        uv_loop_close(&watcher->loop);
        uv_mutex_destroy(&watcher->mutex);
        free(watcher);
        return NULL;
    }

    watcher->fs_event.data = watcher;
    watcher->stop_async.data = watcher;

    unsigned int flags = 0;

#if defined(__APPLE__) || defined(_WIN32)
    if (recursive) {
        flags |= UV_FS_EVENT_RECURSIVE;
    }
#else
    (void)recursive;
#endif

    int r = uv_fs_event_start(&watcher->fs_event, on_fs_event, path, flags);
    if (r < 0) {
        uv_close((uv_handle_t *)&watcher->stop_async, NULL);
        uv_run(&watcher->loop, UV_RUN_DEFAULT);
        uv_loop_close(&watcher->loop);
        uv_mutex_destroy(&watcher->mutex);
        free(watcher);
        return NULL;
    }

    if (uv_thread_create(&watcher->thread, watcher_thread_main, watcher) != 0) {
        uv_fs_event_stop(&watcher->fs_event);
        uv_close((uv_handle_t *)&watcher->fs_event, NULL);
        uv_close((uv_handle_t *)&watcher->stop_async, NULL);
        uv_run(&watcher->loop, UV_RUN_DEFAULT);
        uv_loop_close(&watcher->loop);
        uv_mutex_destroy(&watcher->mutex);
        free(watcher);
        return NULL;
    }

    return watcher;
}

int watcher_next_event(Watcher *watcher, WatchEvent *out) {
    if (!watcher || !out) return 0;

    uv_mutex_lock(&watcher->mutex);

    EventNode *node = watcher->head;

    if (!node) {
        uv_mutex_unlock(&watcher->mutex);
        return 0;
    }

    watcher->head = node->next;

    if (!watcher->head) {
        watcher->tail = NULL;
    }

    uv_mutex_unlock(&watcher->mutex);

    *out = node->event;
    free(node);

    return 1;
}

void watcher_stop(Watcher *watcher) {
    if (!watcher) return;
    uv_async_send(&watcher->stop_async);
}

void watcher_free(Watcher *watcher) {
    if (!watcher) return;

    watcher_stop(watcher);
    uv_thread_join(&watcher->thread);

    EventNode *node = watcher->head;
    while (node) {
        EventNode *next = node->next;
        free(node);
        node = next;
    }

    uv_loop_close(&watcher->loop);
    uv_mutex_destroy(&watcher->mutex);

    free(watcher);
}