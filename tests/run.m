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
// error callback, "restart atResumePoint=<0|1> stop=<line>" from the
// restart callback, and "log: <line>" from the log callback. A line of
// "expect" that ends with "*" matches each line that starts with the text
// before it. A game runs until it has all the lines of "expect", or until
// it exits.
//
// A game that logs "stop the web content process" gets its web content
// process stopped, as iOS stops it when it needs memory.

#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#include <signal.h>

#include "../src/mvmz_core.h"

static NSMutableArray<NSString *> *gLines;
static BOOL gExited;
static WKWebView *gWebView;

// WebKit has no public call that stops the web content process.
static void stopWebContentProcess(void) {
    const pid_t pid = [[gWebView valueForKey:@"_webProcessIdentifier"] intValue];
    if (pid > 0) {
        kill(pid, SIGKILL);
    }
}

static void onLog(const char *line, void *userdata) {
    NSString *text = @(line);
    [gLines addObject:[@"log: " stringByAppendingString:text]];
    if ([text isEqualToString:@"console.log: stop the web content process"]) {
        stopWebContentProcess();
    }
}

static void onRestart(int atResumePoint, const char *stop, void *userdata) {
    [gLines addObject:[NSString stringWithFormat:@"restart atResumePoint=%d stop=%s", atResumePoint, stop]];
}

static void onError(const char *message, void *userdata) {
    [gLines addObject:[@"error: " stringByAppendingString:@(message)]];
}

static void onFrame(void *userdata) {
    [gLines addObject:@"frame"];
}

static void onExit(int clean, void *userdata) {
    [gLines addObject:[NSString stringWithFormat:@"exit clean=%d", clean]];
    gExited = YES;
}

static BOOL matches(NSString *line, NSString *wanted) {
    if ([wanted hasSuffix:@"*"]) {
        return [line hasPrefix:[wanted substringToIndex:wanted.length - 1]];
    }
    return [line isEqualToString:wanted];
}

static NSArray<NSString *> *missingLines(NSArray<NSString *> *lines, NSArray<NSString *> *expected) {
    NSMutableArray<NSString *> *missing = [NSMutableArray array];
    for (NSString *wanted in expected) {
        NSUInteger found = [lines indexOfObjectPassingTest:^BOOL(NSString *line, NSUInteger i, BOOL *stop) {
            return matches(line, wanted);
        }];
        if (found == NSNotFound) {
            [missing addObject:wanted];
        }
    }
    return missing;
}

// With expected lines, the game runs until it has them all or exits.
static NSArray<NSString *> *runGame(NSString *gameDir, NSTimeInterval seconds, NSArray<NSString *> *expected) {
    gLines = [NSMutableArray array];
    gExited = NO;
    // WebKit runs the frames of the page only in a visible window, and
    // the app learns that the window is visible from its events.
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 816, 624)
                                                   styleMask:NSWindowStyleMaskBorderless
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    window.releasedWhenClosed = NO;
    gWebView = (__bridge WKWebView *)mvmz_start(gameDir.fileSystemRepresentation, gameDir.UTF8String);
    gWebView.frame = window.contentView.bounds;
    [window.contentView addSubview:gWebView];
    [window orderFrontRegardless];

    NSDate *limit = [NSDate dateWithTimeIntervalSinceNow:seconds];
    while (!(expected && (gExited || !missingLines(gLines, expected).count)) && limit.timeIntervalSinceNow > 0) {
        NSEvent *event = [NSApp nextEventMatchingMask:NSEventMaskAny
                                            untilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]
                                               inMode:NSDefaultRunLoopMode
                                              dequeue:YES];
        if (event) [NSApp sendEvent:event];
    }
    mvmz_stop();
    gWebView = nil;
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
        mvmz_set_restart_callback(onRestart, NULL);

        NSString *folder = @(argv[1]);
        if (argc > 2) {
            for (NSString *line in runGame(folder, atof(argv[2]), nil)) {
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
            NSArray<NSString *> *expected = [[expect componentsSeparatedByString:@"\n"]
                filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"length > 0"]];
            NSArray<NSString *> *lines = runGame(gameDir, 10, expected);
            NSArray<NSString *> *missing = missingLines(lines, expected);
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
