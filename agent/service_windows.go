//go:build windows

package main

import "golang.org/x/sys/windows/svc"

// isWindowsService reports whether we were launched by the Service Control
// Manager (vs an interactive run during install).
func isWindowsService() bool {
	ok, err := svc.IsWindowsService()
	return err == nil && ok
}

// avaService adapts the agent loop to the Windows SCM so Stop/Shutdown are
// handled gracefully and a crash triggers the service's failure action (restart).
type avaService struct{}

func (avaService) Execute(args []string, r <-chan svc.ChangeRequest, s chan<- svc.Status) (bool, uint32) {
	const accepted = svc.AcceptStop | svc.AcceptShutdown
	s <- svc.Status{State: svc.StartPending}
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() { runAgent(stop); close(done) }()
	s <- svc.Status{State: svc.Running, Accepts: accepted}
	for {
		select {
		case c := <-r:
			switch c.Cmd {
			case svc.Interrogate:
				s <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				s <- svc.Status{State: svc.StopPending}
				close(stop)
				<-done
				s <- svc.Status{State: svc.Stopped}
				return false, 0
			}
		case <-done:
			// runAgent returned on its own (e.g. enroll failure) — exit non-zero
			// so the SCM failure action restarts the service and we retry.
			s <- svc.Status{State: svc.Stopped}
			return false, 1
		}
	}
}

func runService() { _ = svc.Run("ComplyVerseAgent", avaService{}) }
