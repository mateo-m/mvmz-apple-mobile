#import <CommonCrypto/CommonDigest.h>
#import <Metal/Metal.h>
#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

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
        if (gFrame) {
            gFrame(gFrameData);
        }
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
    } else if ([type isEqualToString:@"exit"]) {
        logLine(@"the game closed itself");
        exitGame(YES);
    }
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation
      withError:(NSError *)error {
    logLine([NSString stringWithFormat:@"index.html did not load: %@", error]);
    exitGame(NO);
}

// The web content process ran out of memory or crashed, and the page is
// gone with it.
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
    logLine(@"the web content process stopped");
    exitGame(NO);
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

static NSString *jsonString(id object) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
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
    config.allowsInlineMediaPlayback = YES;

    NSDictionary *settings = @{
        @"speed" : @(gSpeed),
        @"smooth" : @(gSmooth),
        @"simulator" : @(TARGET_OS_SIMULATOR),
    };
    NSString *source = [NSString stringWithFormat:@"window.__mvmzSettings = %@;\n%s", jsonString(settings),
                                                  runtimeSource];
    WKUserScript *script = [[WKUserScript alloc] initWithSource:source
                                                  injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                               forMainFrameOnly:YES];
    [config.userContentController addUserScript:script];
    [config.userContentController addScriptMessageHandler:gMessages name:@"mvmz"];

    gWebView = [[WKWebView alloc] initWithFrame:CGRectZero configuration:config];
    // With the user agent of a phone, MV asks for .m4a audio that many
    // desktop games do not ship, MV drops its fixed update rate, and MZ
    // uses only 90% of the screen height.
    gWebView.customUserAgent =
        @"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
    gWebView.navigationDelegate = gMessages;
    gWebView.UIDelegate = gMessages;
    gWebView.opaque = NO;
    gWebView.backgroundColor = UIColor.blackColor;
    gWebView.scrollView.scrollEnabled = NO;
    gWebView.scrollView.bounces = NO;
    gWebView.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;

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
}

// runtime.js turns the scancode into the keyCode the game reads.
void mvmz_inject_key(int usage, int pressed) {
    runJS([NSString stringWithFormat:@"__mvmz.key(%d,%d)", usage, pressed]);
}

void mvmz_pause(void (*done)(void *), void *userdata) {
    [gWebView evaluateJavaScript:@"__mvmz.pause()"
               completionHandler:^(id result, NSError *error) {
                   if (done) {
                       done(userdata);
                   }
               }];
}

void mvmz_resume(void) {
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

double mvmz_fps(void) {
    return gFps;
}

const char *mvmz_details(void) {
    return gDetails ? gDetails : "";
}
