// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Mateo M. Additional terms apply: see ADDITIONAL-TERMS.md.

#import <CommonCrypto/CommonDigest.h>
#import <Metal/Metal.h>
#import <TargetConditionals.h>
#if TARGET_OS_OSX
#import <AppKit/AppKit.h>
#else
#import <UIKit/UIKit.h>
#endif
#import <WebKit/WebKit.h>
#include <mach/mach.h>

#include "mvmz_core.h"
#import "MvmzFileServer.h"

static const char runtimeSource[] = {
#embed "runtime.js"
    , 0};

static WKWebView *gWebView;
static int gSpeed = 1;
static BOOL gSmooth;
static double gFps;
static char *gDetails;
static NSString *gResumePoint;
static BOOL gPaused;
static BOOL gPageStopped;
static NSString *gLoadingResumePoint;

typedef enum { PageLoading, PageReloading, PageRunning } PageState;
static PageState gPageState;
// The core loaded the page again after a stop, and the game made no new
// resume point since then.
static BOOL gReloaded;
static NSString *gStopLine;

static void (*gFrame)(void *);
static void *gFrameData;
static void (*gSize)(int, int, void *);
static void *gSizeData;
static void (*gExit)(int, void *);
static void *gExitData;
static void (*gAlert)(const char *, void *);
static void *gAlertData;
static void (*gLog)(const char *, void *);
static void *gLogData;
static void (*gError)(const char *, void *);
static void *gErrorData;
static void (*gRestart)(int, const char *, void *);
static void *gRestartData;

static void logLine(NSString *line) {
    if (gLog) {
        gLog(line.UTF8String, gLogData);
    } else {
        NSLog(@"[mvmz] %@", line);
    }
}

static void runJS(NSString *script) {
    [gWebView evaluateJavaScript:script completionHandler:nil];
}

static void exitGame(BOOL clean) {
    if (gExit) {
        gExit(clean, gExitData);
    }
}

static NSString *jsonString(id object) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

static void setRuntime(WKUserContentController *controller, NSString *resumePoint) {
    [controller removeAllUserScripts];
    gLoadingResumePoint = resumePoint;
    NSMutableDictionary *settings = [@{
        @"speed" : @(gSpeed),
        @"smooth" : @(gSmooth),
        @"simulator" : @(TARGET_OS_SIMULATOR),
    } mutableCopy];
    settings[@"resumePoint"] = resumePoint;
    NSString *source = [NSString stringWithFormat:@"window.__mvmzSettings = %@;\n%s", jsonString(settings),
                                                  runtimeSource];
    WKUserScript *script = [[WKUserScript alloc] initWithSource:source
                                                  injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                               forMainFrameOnly:YES];
    [controller addUserScript:script];
}

static void restarted(BOOL atResumePoint) {
    if (gRestart) {
        gRestart(atResumePoint, gStopLine.UTF8String, gRestartData);
    }
}

static NSString *thermalName(NSProcessInfoThermalState state) {
    switch (state) {
    case NSProcessInfoThermalStateNominal:
        return @"nominal";
    case NSProcessInfoThermalStateFair:
        return @"fair";
    case NSProcessInfoThermalStateSerious:
        return @"serious";
    case NSProcessInfoThermalStateCritical:
        return @"critical";
    }
    return @"unknown";
}

// An app cannot read the memory of the web content process, so the line
// gives the free memory of the device and the footprint of the app.
static NSString *makeStopLine(void) {
    const unsigned long long mb = 1024 * 1024;
    NSString *freeMemory = @"unknown";
    mach_port_t host = mach_host_self();
    vm_size_t pageSize;
    vm_statistics64_data_t vm;
    mach_msg_type_number_t count = HOST_VM_INFO64_COUNT;
    if (host_page_size(host, &pageSize) == KERN_SUCCESS &&
        host_statistics64(host, HOST_VM_INFO64, (host_info64_t)&vm, &count) == KERN_SUCCESS) {
        freeMemory = [NSString stringWithFormat:@"%llu MB", (unsigned long long)vm.free_count * pageSize / mb];
    }
    mach_port_deallocate(mach_task_self(), host);
    NSString *footprint = @"unknown";
    task_vm_info_data_t task;
    count = TASK_VM_INFO_COUNT;
    if (task_info(mach_task_self(), TASK_VM_INFO, (task_info_t)&task, &count) == KERN_SUCCESS) {
        footprint = [NSString stringWithFormat:@"%llu MB", task.phys_footprint / mb];
    }
    return [NSString stringWithFormat:@"the web content process stopped: %@ of %llu MB free, the app uses %@, "
                                      @"thermal state %@",
                                      freeMemory, NSProcessInfo.processInfo.physicalMemory / mb, footprint,
                                      thermalName(NSProcessInfo.processInfo.thermalState)];
}

// A page that stops again before the game makes a new resume point ends
// the game, so a stop that comes back each time cannot load the page
// forever.
static void reloadAfterStop(void) {
    logLine(gResumePoint ? @"the game starts again from its resume point"
                         : @"the game starts again at its title screen");
    setRuntime(gWebView.configuration.userContentController, gResumePoint);
    gPageStopped = NO;
    gReloaded = YES;
    gPageState = PageReloading;
    [gWebView reload];
}

__attribute__((visibility("hidden")))
@interface MvmzMessages : NSObject <WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate>
@end

@implementation MvmzMessages

// runtime.js posts one dictionary for each event, keyed by "type".
- (void)userContentController:(WKUserContentController *)controller
      didReceiveScriptMessage:(WKScriptMessage *)message {
    NSDictionary *body = message.body;
    if (![body isKindOfClass:NSDictionary.class]) {
        return;
    }
    NSString *type = body[@"type"];
    if ([type isEqualToString:@"frame"]) {
        // The page posts a frame after each load and each resume. A frame
        // while paused comes from a page that loaded after the pause.
        if (gPaused) {
            runJS(@"__mvmz.pause()");
        }
        if (gPageState == PageReloading && !gLoadingResumePoint) {
            restarted(NO);
        }
        if (gLoadingResumePoint) {
            setRuntime(gWebView.configuration.userContentController, nil);
        }
        gPageState = PageRunning;
        if (gFrame) {
            gFrame(gFrameData);
        }
    } else if ([type isEqualToString:@"resumePoint"]) {
        NSString *point = body[@"point"];
        gResumePoint = [point isKindOfClass:NSString.class] ? point : nil;
        if (gResumePoint) {
            gReloaded = NO;
        }
    } else if ([type isEqualToString:@"restarted"]) {
        restarted([body[@"atResumePoint"] boolValue]);
    } else if ([type isEqualToString:@"fps"]) {
        gFps = [body[@"fps"] doubleValue];
    } else if ([type isEqualToString:@"details"]) {
        NSMutableArray<NSString *> *lines = [body[@"lines"] mutableCopy];
        NSString *device = MTLCreateSystemDefaultDevice().name;
        if (device) [lines addObject:device];
        free(gDetails);
        gDetails = strdup([lines componentsJoinedByString:@"\n"].UTF8String);
    } else if ([type isEqualToString:@"size"]) {
        const int width = [body[@"width"] intValue];
        const int height = [body[@"height"] intValue];
        logLine([NSString stringWithFormat:@"game size %dx%d", width, height]);
        if (gSize) {
            gSize(width, height, gSizeData);
        }
    } else if ([type isEqualToString:@"log"]) {
        logLine([NSString stringWithFormat:@"%@", body[@"text"]]);
    } else if ([type isEqualToString:@"bootError"]) {
        NSString *text = body[@"message"];
        logLine([NSString stringWithFormat:@"the game did not start: %@", text]);
        if (gError) {
            gError(text.UTF8String, gErrorData);
        }
        exitGame(NO);
    } else if ([type isEqualToString:@"exit"]) {
        logLine(@"the game closed itself");
        exitGame(YES);
    }
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation
      withError:(NSError *)error {
    // The back-forward list gets its first item when the first page
    // commits. A later load that fails, for example a reload that a
    // second reload replaces (-999 or WebKit error 102), keeps the page
    // that was there.
    // A reload after the web content process stopped has no page to keep.
    if (webView.backForwardList.currentItem && gPageState != PageReloading) {
        return;
    }
    logLine([NSString stringWithFormat:@"index.html did not load: %@", error]);
    exitGame(NO);
}

// The web content process ran out of memory or crashed, and the page is
// gone with it. iOS stops it to get memory back, also while the app is
// in the background.
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
    gStopLine = makeStopLine();
    logLine(gStopLine);
    if (gPageState == PageLoading) {
        exitGame(NO);
    } else if (gPaused) {
        // Each reload after a stop in the background needs the player to
        // come back to the game, so it cannot repeat by itself.
        gPageStopped = YES;
    } else if (gPageState != PageRunning) {
        exitGame(NO);
    } else if (gReloaded) {
        logLine(@"the game stopped again before it made a new resume point");
        exitGame(NO);
    } else {
        reloadAfterStop();
    }
}

// A page that the game loads itself, for example to go back to its title
// screen, does not go back to the resume point after a stop.
- (void)webView:(WKWebView *)webView didCommitNavigation:(WKNavigation *)navigation {
    if (gPageState == PageRunning) {
        gResumePoint = nil;
    }
}

// WebKit shows no alert without a UI delegate, for example from a plugin
// that reports a missing file.
- (void)webView:(WKWebView *)webView runJavaScriptAlertPanelWithMessage:(NSString *)message
    initiatedByFrame:(WKFrameInfo *)frame
    completionHandler:(void (^)(void))completionHandler {
    logLine([NSString stringWithFormat:@"alert: %@", message]);
    if (gAlert) {
        gAlert(message.UTF8String, gAlertData);
    }
    completionHandler();
}

- (void)webView:(WKWebView *)webView runJavaScriptConfirmPanelWithMessage:(NSString *)message
    initiatedByFrame:(WKFrameInfo *)frame
    completionHandler:(void (^)(BOOL))completionHandler {
    logLine([NSString stringWithFormat:@"confirm, answered yes: %@", message]);
    completionHandler(YES);
}

@end

static MvmzMessages *gMessages;
static MvmzFileServer *gFileServer;

static NSString *originHost(const char *gameId) {
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(gameId, (CC_LONG)strlen(gameId), digest);
    NSMutableString *host = [NSMutableString stringWithString:@"game-"];
    for (int i = 0; i < 16; i++) {
        [host appendFormat:@"%02x", digest[i]];
    }
    return host;
}

void *mvmz_start(const char *gameDir, const char *gameId) {
    mvmz_stop();
    if (!gameDir || !gameDir[0]) {
        logLine(@"no game folder");
        return NULL;
    }
    NSString *root = @(gameDir);

    gFileServer = [[MvmzFileServer alloc] initWithRoot:root];
    gMessages = [[MvmzMessages alloc] init];

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    [config setURLSchemeHandler:gFileServer forURLScheme:MvmzFileServer.scheme];
    // The game starts its music before the first touch, as it does on a
    // desktop.
    config.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
#if !TARGET_OS_OSX
    config.allowsInlineMediaPlayback = YES;
#endif

    setRuntime(config.userContentController, nil);
    [config.userContentController addScriptMessageHandler:gMessages name:@"mvmz"];

    gWebView = [[WKWebView alloc] initWithFrame:CGRectZero configuration:config];
    // With the user agent of a phone, MV asks for .m4a audio that many
    // desktop games do not ship, MV drops its fixed update rate, and MZ
    // uses only 90% of the screen height.
    gWebView.customUserAgent =
        @"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
    gWebView.navigationDelegate = gMessages;
    gWebView.UIDelegate = gMessages;
#if TARGET_OS_OSX
    gWebView.underPageBackgroundColor = NSColor.blackColor;
#else
    gWebView.opaque = NO;
    gWebView.backgroundColor = UIColor.blackColor;
    gWebView.scrollView.scrollEnabled = NO;
    gWebView.scrollView.bounces = NO;
    gWebView.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
#endif

    NSURL *url = [NSURL URLWithString:[NSString stringWithFormat:@"%@://%@/index.html", MvmzFileServer.scheme,
                                                                  originHost(gameId ?: "")]];
    logLine([NSString stringWithFormat:@"boot %@ from %@", url, root]);
    [gWebView loadRequest:[NSURLRequest requestWithURL:url]];
    return (__bridge void *)gWebView;
}

// The message handler holds the web view until it is removed.
void mvmz_stop(void) {
    [gWebView.configuration.userContentController removeAllScriptMessageHandlers];
    [gWebView stopLoading];
    [gWebView removeFromSuperview];
    gWebView = nil;
    gMessages = nil;
    gFileServer = nil;
    gFps = 0;
    free(gDetails);
    gDetails = NULL;
    gResumePoint = nil;
    gPaused = NO;
    gPageStopped = NO;
    gLoadingResumePoint = nil;
    gPageState = PageLoading;
    gReloaded = NO;
    gStopLine = nil;
}

// runtime.js turns the scancode into the keyCode the game reads.
void mvmz_inject_key(int usage, int pressed) {
    runJS([NSString stringWithFormat:@"__mvmz.key(%d,%d)", usage, pressed]);
}

// A pause fails on a page that is gone or that has not loaded yet, and it
// gives no point while an event runs. The core then keeps the last resume
// point, or the one that the page loads: the page clears the point when the
// game saves after it. The page can also stop before its answer comes, so
// that point holds from the pause on.
// A point from a pause does not show that the game ran after a restart:
// during the boot scene, the page gives back the point that it loads.
void mvmz_pause(void (*done)(void *), void *userdata) {
    gPaused = YES;
    if (!gResumePoint) {
        gResumePoint = gLoadingResumePoint;
    }
    WKWebView *webView = gWebView;
    [webView evaluateJavaScript:@"__mvmz.pause()"
              completionHandler:^(id result, NSError *error) {
                  if (webView == gWebView && !error && [result isKindOfClass:NSString.class]) {
                      gResumePoint = result;
                  }
                  if (done) {
                      done(userdata);
                  }
              }];
}

void mvmz_resume(void) {
    gPaused = NO;
    if (gPageStopped) {
        reloadAfterStop();
        return;
    }
    runJS(@"__mvmz.resume()");
}

void mvmz_set_speed(int multiplier) {
    gSpeed = multiplier;
    runJS([NSString stringWithFormat:@"window.__mvmz && __mvmz.setSpeed(%d)", multiplier]);
}

void mvmz_set_smooth(int smooth) {
    gSmooth = smooth != 0;
}

void mvmz_set_frame_callback(void (*callback)(void *), void *userdata) {
    gFrame = callback;
    gFrameData = userdata;
}

void mvmz_set_size_callback(void (*callback)(int, int, void *), void *userdata) {
    gSize = callback;
    gSizeData = userdata;
}

void mvmz_set_exit_callback(void (*callback)(int, void *), void *userdata) {
    gExit = callback;
    gExitData = userdata;
}

void mvmz_set_alert_callback(void (*callback)(const char *, void *), void *userdata) {
    gAlert = callback;
    gAlertData = userdata;
}

void mvmz_set_log_callback(void (*callback)(const char *, void *), void *userdata) {
    gLog = callback;
    gLogData = userdata;
}

void mvmz_set_error_callback(void (*callback)(const char *, void *), void *userdata) {
    gError = callback;
    gErrorData = userdata;
}

void mvmz_set_restart_callback(void (*callback)(int, const char *, void *), void *userdata) {
    gRestart = callback;
    gRestartData = userdata;
}

double mvmz_fps(void) {
    return gFps;
}

const char *mvmz_details(void) {
    return gDetails ? gDetails : "";
}
