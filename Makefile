# Builds out/<sdk>/libmvmz.a for one SDK.
#
#   make SDK=iphonesimulator
#   make SDK=iphoneos
#   make SDK=macosx

SDK ?= iphonesimulator
ARCH := arm64
MINIMUM_REQUIRED := 26.0

ifeq ($(SDK),iphonesimulator)
TARGET := $(ARCH)-apple-ios$(MINIMUM_REQUIRED)-simulator
else ifeq ($(SDK),iphoneos)
TARGET := $(ARCH)-apple-ios$(MINIMUM_REQUIRED)
else ifeq ($(SDK),macosx)
TARGET := $(ARCH)-apple-macos$(MINIMUM_REQUIRED)
else
$(error SDK must be iphoneos, iphonesimulator or macosx)
endif

CC := $(shell xcrun --sdk $(SDK) -f clang)
AR := $(shell xcrun --sdk $(SDK) -f ar)
SYSROOT := $(shell xcrun --sdk $(SDK) --show-sdk-path)
CFLAGS := -isysroot $(SYSROOT) -target $(TARGET) -fobjc-arc -Os -Wall -Werror -Wno-c23-extensions

OUT := out/$(SDK)
SOURCES := src/mvmz_core.m src/MvmzFileServer.m
OBJECTS := $(SOURCES:src/%.m=$(OUT)/obj/%.o)

$(OUT)/libmvmz.a: $(OBJECTS)
	rm -f $@
	$(AR) rcs $@ $^

$(OUT)/obj/%.o: src/%.m src/mvmz_core.h src/MvmzFileServer.h src/runtime.js
	mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

clean:
	rm -rf out

.PHONY: clean
