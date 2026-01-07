# TODO - OSC 9 Notification Support

## Completed
- [x] Add ghostty.notifications setting to package.json (iteration 1)
- [x] Add parseOSC9() function in terminal-manager.ts (iteration 1)
- [x] Call parseOSC9() in handlePtyData() (iteration 1)
- [x] Show VS Code notification when OSC 9 is detected (iteration 1)
- [x] Run build, typecheck, and lint - all pass (iteration 1)

## In Progress
(none)

## Pending
(none)

## Blocked
(none)

## Notes
- OSC 9 format: ESC ] 9 ; message BEL (or ST)
- Handles both BEL (\x07) and ST (\x1b\\) terminators
- Controlled by ghostty.notifications setting (default: true)
- Uses vscode.window.showInformationMessage() for notifications
