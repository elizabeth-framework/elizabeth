.PHONY: default compile test clean

default: compile 

compile:
	cmake -B build
	cmake --build build

test:
	build/test
	
clean:
	rm -rf build/*
