// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Mateo M. Additional terms apply: see ADDITIONAL-TERMS.md.

// MV/MZ core: runs a released RPG Maker MV or MZ game on iOS and macOS.
//
// An MV or MZ game is a web page that carries its own engine as
// JavaScript. The core shows the game's index.html in a WKWebView,
// serves the game folder to the page, and makes the page look like
// NW.js, the desktop runtime that the game shipped for. The saves go to
// the game folder, as they do on a desktop.
//
// libmvmz.a defines the names below. Link WebKit, UIKit (AppKit on macOS), Metal and
// UniformTypeIdentifiers next to it.
//
// Call every function on the main thread. The core calls each callback
// on the main thread.
#ifndef MVMZ_CORE_H
#define MVMZ_CORE_H

#ifdef __cplusplus
extern "C" {
#endif

// Loads the game in gameDir and returns its web view, a WKWebView, or
// null when gameDir is empty. A game that runs stops first.
//
// The host puts the web view in a window and sets its frame. WebKit
// holds the page until the web view is in a visible window. The game
// scales its picture to the web view, so give the web view the
// proportions that the size callback reports.
//
// gameId names the game. Each gameId gets its own web origin, so one
// game cannot read the localStorage and the IndexedDB of another. Give
// a game the same gameId each time, or it loses that data.
void *mvmz_start(const char *gameDir, const char *gameId);

// Ends the page and all of its JavaScript, and removes the web view from
// its superview.
void mvmz_stop(void);

// MARK: - Input

// Presses or releases one key. usage is the USB HID usage ID of the key
// on the keyboard page (0x07), which is also the SDL scancode. A key
// that has no DOM keyCode does nothing.
//
// The page sees no game controller. Send the controller buttons as keys.
// Touches reach the page from the web view.
void mvmz_inject_key(int usage, int pressed);

// MARK: - Pause

// Holds the game's frames, and pauses its sound and its video. done runs
// when the page stopped, so a snapshot of the web view then shows the
// frame the game stopped on. done can be null.
//
// The pause also keeps the game state in memory when the game could save:
// on its map or in a menu over it, with no event, message, or scene change
// in progress. See mvmz_set_restart_callback for what the core does with
// it.
void mvmz_pause(void (*done)(void *userdata), void *userdata);

// Starts the frames, the sound and the video again.
void mvmz_resume(void);

// MARK: - Settings

// Game updates for each drawn frame. 1 by default. A new value applies
// to the game that runs and to the next start.
void mvmz_set_speed(int multiplier);

// Smooth (1) or sharp (0) scaling of the picture. Sharp by default. The
// next mvmz_start reads it.
void mvmz_set_smooth(int smooth);

// MARK: - What the game reports

// Called on the first frame after mvmz_start, after each mvmz_resume,
// and after each reload (see mvmz_set_restart_callback).
void mvmz_set_frame_callback(void (*callback)(void *userdata), void *userdata);

// Called with the resolution of the game when it boots, and each time
// the game changes it.
void mvmz_set_size_callback(void (*callback)(int width, int height, void *userdata),
                            void *userdata);

// Called when the game stops by itself. clean is 1 when the game closed
// itself. clean is 0 when index.html did not load, the game did not
// start, or the web content process stopped and the core cannot load the
// page again (see mvmz_set_restart_callback). In that case the game
// cannot go on.
void mvmz_set_exit_callback(void (*callback)(int clean, void *userdata), void *userdata);

// Called with the error that stopped the game before its first frame,
// for example a script error in main.js. The exit callback with clean 0
// follows.
void mvmz_set_error_callback(void (*callback)(const char *message, void *userdata),
                             void *userdata);

// iOS stops the web content process when it needs memory, also in the
// background, and the game state goes with it. The core keeps a resume
// point: the game state in memory, at each pause and while the game runs,
// at most every 30 seconds and on each new map, when the game could save
// (see mvmz_pause). The title screen and the game over screen clear it.
// A save in an event also clears it, because the core cannot keep a point
// there. So does a page that the game loads itself.
//
// After a stop, the core loads the page again, at the next mvmz_resume
// when the game is paused. The game goes back to its newest resume point,
// or starts at its title screen when it has none or the point does not
// load. Then this callback runs. atResumePoint is 1 when the game is back
// at its resume point. stop is the log line of the stop, with the free
// memory of the device, the memory of the app, and the thermal state.
//
// The exit callback runs when the page stops before its first frame, also
// while the game is paused, or does not load. It also runs when the page
// stops again during play before the game made a new resume point as it
// runs. A point from a pause does not count. A stop while the game is
// paused after its first frame always loads the page again at the next
// mvmz_resume. The saves of the player stay as they are.
void mvmz_set_restart_callback(void (*callback)(int atResumePoint, const char *stop, void *userdata),
                               void *userdata);

// Called with the text of the game's window.alert. The page waits until
// the callback returns. window.confirm always gets yes.
void mvmz_set_alert_callback(void (*callback)(const char *message, void *userdata),
                             void *userdata);

// Called with each log line of the core, and with the console lines and
// the errors of the page. Without a callback, the core writes them with
// NSLog.
void mvmz_set_log_callback(void (*callback)(const char *line, void *userdata), void *userdata);

// Frames per second, measured once a second. 0 before the first
// measurement.
double mvmz_fps(void);

// The RPG Maker version, the PixiJS version with its renderer, and the
// GPU name, one on each line. "" until the game boots.
const char *mvmz_details(void);

#ifdef __cplusplus
}
#endif

#endif
