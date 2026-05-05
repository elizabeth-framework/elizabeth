cmake_minimum_required(VERSION 3.16)

project(
    elizabeth
    VERSION 0.0.3
    DESCRIPTION "Elizabeth is a Bun full-stack web framework"
    LANGUAGES C
)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

find_package(PkgConfig REQUIRED)
pkg_check_modules(LIBUV REQUIRED IMPORTED_TARGET libuv)

add_library(elizabeth_native SHARED
    src/io/file.c
    src/io/watcher.c
)

target_include_directories(elizabeth_native PUBLIC
    src
)

target_link_libraries(elizabeth_native PRIVATE
    PkgConfig::LIBUV
)

target_compile_definitions(elizabeth_native PRIVATE
    _POSIX_C_SOURCE=200809L
)

add_executable(test
    test/test.c
)

target_include_directories(test PRIVATE
    src
)

target_link_libraries(test PRIVATE
    elizabeth_native
)

target_compile_definitions(test PRIVATE
    _POSIX_C_SOURCE=200809L
)