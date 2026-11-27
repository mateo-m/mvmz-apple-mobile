// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Mateo M. Additional terms apply: see ADDITIONAL-TERMS.md.

// Starts games on macOS and checks the lines that the core reports.
//
//   run-tests tests/games        runs each game that has a file "expect",
//                                and fails when a line of it is missing
//   run-tests path/to/game 30    runs one game for 30 seconds and prints
//                                its lines
//
// The lines are "frame", "exit clean=<0|1>", "error: <message>" from the
// error callback, and "log: <line>" from the log callback.

#import <AppKit/AppKit.h>

#include "../src/mvmz_core.h"

static NSMutableArray<NSString *> *gLines;
static BOOL gDone;

static void onLog(const char *line, void *userdata) {
    [gLines addObject:[@"log: " stringByAppendingString:@(line)]];
}

static void onError(const char *message, void *userdata) {
    [gLines addObject:[@"error: " stringByAppendingString:@(message)]];
}

static void onFrame(void *userdata) {
    [gLines addObject:@"frame"];
    gDone = YES;
}

static void onExit(int clean, void *userdata) {
    [gLines addObject:[NSString stringWithFormat:@"exit clean=%d", clean]];
    gDone = YES;
}

static NSArray<NSString *> *runGame(NSString *gameDir, NSTimeInterval seconds, BOOL untilDone) {
    gLines = [NSMutableArray array];
    gDone = NO;
    // WebKit runs the frames of the page only in a visible window, and
    // the app learns that the window is visible from its events.
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 816, 624)
                                                   styleMask:NSWindowStyleMaskBorderless
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    window.releasedWhenClosed = NO;
    NSView *webView = (__bridge NSView *)mvmz_start(gameDir.fileSystemRepresentation, gameDir.UTF8String);
    webView.frame = window.contentView.bounds;
    [window.contentView addSubview:webView];
    [window orderFrontRegardless];

    NSDate *limit = [NSDate dateWithTimeIntervalSinceNow:seconds];
    while (!(untilDone && gDone) && limit.timeIntervalSinceNow > 0) {
        NSEvent *event = [NSApp nextEventMatchingMask:NSEventMaskAny
                                            untilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]
                                               inMode:NSDefaultRunLoopMode
                                              dequeue:YES];
        if (event) [NSApp sendEvent:event];
    }
    mvmz_stop();
    [window close];
    return gLines;
}

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc < 2) {
            fprintf(stderr, "usage: %s <games folder> | <game folder> <seconds>\n", argv[0]);
            return 2;
        }
        [NSApplication sharedApplication];
        NSApp.activationPolicy = NSApplicationActivationPolicyAccessory;
        mvmz_set_log_callback(onLog, NULL);
        mvmz_set_error_callback(onError, NULL);
        mvmz_set_frame_callback(onFrame, NULL);
        mvmz_set_exit_callback(onExit, NULL);

        NSString *folder = @(argv[1]);
        if (argc > 2) {
            for (NSString *line in runGame(folder, atof(argv[2]), NO)) {
                printf("%s\n", line.UTF8String);
            }
            return 0;
        }

        NSError *error;
        NSArray<NSString *> *names = [[NSFileManager.defaultManager contentsOfDirectoryAtPath:folder error:&error]
            sortedArrayUsingSelector:@selector(compare:)];
        if (!names) {
            fprintf(stderr, "cannot read %s: %s\n", folder.UTF8String, error.localizedDescription.UTF8String);
            return 1;
        }
        int games = 0;
        int failures = 0;
        for (NSString *name in names) {
            NSString *gameDir = [folder stringByAppendingPathComponent:name];
            NSString *expect = [NSString stringWithContentsOfFile:[gameDir stringByAppendingPathComponent:@"expect"]
                                                         encoding:NSUTF8StringEncoding
                                                            error:nil];
            if (!expect) {
                continue;
            }
            games++;
            NSArray<NSString *> *lines = runGame(gameDir, 10, YES);
            NSMutableArray<NSString *> *missing = [NSMutableArray array];
            for (NSString *wanted in [expect componentsSeparatedByString:@"\n"]) {
                if (wanted.length && ![lines containsObject:wanted]) {
                    [missing addObject:wanted];
                }
            }
            if (missing.count) {
                failures++;
                printf("FAIL %s\n", name.UTF8String);
                for (NSString *line in missing) printf("  missing: %s\n", line.UTF8String);
                for (NSString *line in lines) printf("  got: %s\n", line.UTF8String);
            } else {
                printf("ok   %s\n", name.UTF8String);
            }
        }
        if (!games) {
            fprintf(stderr, "no game in %s has a file \"expect\"\n", folder.UTF8String);
            return 1;
        }
        return failures ? 1 : 0;
    }
}
