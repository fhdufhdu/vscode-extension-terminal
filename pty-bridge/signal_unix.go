// +build !windows

package main

import (
	"os"
	"os/signal"
	"syscall"
)

func setupSignalHandler() {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGWINCH)
	go func() {
		for range ch {
			// 실제 터미널 크기 조절은 JSON 메시지로 처리하므로 여기서는 패스
		}
	}()
}
