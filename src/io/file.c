#include "io/file.h"

#include <dirent.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

static int push_entry(DirList *list, const DirEntry *entry) {
    if (list->len >= list->cap) {
        size_t new_cap = list->cap == 0 ? 64 : list->cap * 2;
        DirEntry *new_items = realloc(list->items, new_cap * sizeof list->items[0]);

        if (!new_items) return 0;

        list->items = new_items;
        list->cap = new_cap;
    }

    list->items[list->len++] = *entry;
    return 1;
}

static void walk_dir(const char *path, int recursive, DirList *list) {
    DIR *dir = opendir(path);
    if (!dir) return;

    struct dirent *dp;

    while ((dp = readdir(dir)) != NULL) {
        if (strcmp(dp->d_name, ".") == 0 || strcmp(dp->d_name, "..") == 0) {
            continue;
        }

        char full_path[4096];
        int n = snprintf(full_path, sizeof full_path, "%s/%s", path, dp->d_name);

        if (n < 0 || (size_t)n >= sizeof full_path) {
            continue;
        }

        struct stat st;
        if (lstat(full_path, &st) != 0) {
            continue;
        }

        DirEntry entry = {0};

        snprintf(entry.path, sizeof entry.path, "%s", full_path);
        snprintf(entry.name, sizeof entry.name, "%s", dp->d_name);

        if (S_ISREG(st.st_mode)) {
            entry.is_file = 1;
            entry.kind = ENTRY_FILE;
        } else if (S_ISDIR(st.st_mode)) {
            entry.is_dir = 1;
            entry.kind = ENTRY_DIR;
        } else {
            entry.kind = ENTRY_OTHER;
        }

        if (!push_entry(list, &entry)) {
            break;
        }

        if (recursive && entry.is_dir) {
            walk_dir(full_path, recursive, list);
        }
    }

    closedir(dir);
}

DirList *list_dir(const char *path, int recursive) {
    DirList *list = calloc(1, sizeof *list);
    if (!list) return NULL;

    walk_dir(path, recursive, list);
    return list;
}

size_t dir_list_len(DirList *list) {
    return list ? list->len : 0;
}

const char *dir_list_path(DirList *list, size_t index) {
    if (!list || index >= list->len) return NULL;
    return list->items[index].path;
}

const char *dir_list_name(DirList *list, size_t index) {
    if (!list || index >= list->len) return NULL;
    return list->items[index].name;
}

int dir_list_is_file(DirList *list, size_t index) {
    if (!list || index >= list->len) return 0;
    return list->items[index].is_file;
}

int dir_list_is_dir(DirList *list, size_t index) {
    if (!list || index >= list->len) return 0;
    return list->items[index].is_dir;
}

int dir_list_kind(DirList *list, size_t index) {
    if (!list || index >= list->len) return ENTRY_OTHER;
    return list->items[index].kind;
}

void free_dir_list(DirList *list) {
    if (!list) return;

    free(list->items);
    free(list);
}