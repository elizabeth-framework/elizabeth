#pragma once

#include <stddef.h>
#include <stdint.h>

typedef enum EntryKind {
    ENTRY_FILE = 1,
    ENTRY_DIR = 2,
    ENTRY_OTHER = 3
} EntryKind;

typedef struct DirEntry {
    char path[4096];
    char name[256];
    uint8_t is_file;
    uint8_t is_dir;
    uint8_t kind;
} DirEntry;

typedef struct DirList {
    DirEntry *items;
    size_t len;
    size_t cap;
} DirList;

DirList *list_dir(const char *path, int recursive);

size_t dir_list_len(DirList *list);
const char *dir_list_path(DirList *list, size_t index);
const char *dir_list_name(DirList *list, size_t index);
int dir_list_is_file(DirList *list, size_t index);
int dir_list_is_dir(DirList *list, size_t index);
int dir_list_kind(DirList *list, size_t index);

void free_dir_list(DirList *list);