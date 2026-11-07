//go:build !windows

package main

// Non-Windows builds have no Service Control Manager; systemd/launchd own the
// lifecycle. These stubs keep main() portable (runService is never called here).
func isWindowsService() bool { return false }

func runService() {}
