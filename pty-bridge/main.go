package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"unicode/utf8"

	"github.com/creack/pty"
	"golang.org/x/text/unicode/norm"
)

type Message struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
	Code int    `json:"code,omitempty"`
}

func main() {
	// 1. 기본 쉘 결정
	shell := os.Getenv("SHELL")
	if shell == "" {
		if runtime.GOOS == "windows" {
			shell = "cmd.exe"
		} else {
			shell = "/bin/bash"
		}
	}

	// 2. 환경 변수 설정 (시스템 환경 변수 상속 + 터미널 필수 설정 추가)
	env := os.Environ()
	
	// 터미널 UI와 컬러를 위한 최소한의 설정만 추가/강제
	env = append(env, "TERM=xterm-256color")
	env = append(env, "COLORTERM=truecolor")
	env = append(env, "TERM_PROGRAM=vscode")

	var c *exec.Cmd
	if runtime.GOOS == "windows" {
		c = exec.Command(shell)
	} else {
		c = exec.Command(shell, "--login")
	}
	c.Env = env

	// 3. PTY 시작
	ptmx, err := pty.Start(c)
	if err != nil {
		sendError(err)
		os.Exit(1)
	}
	defer func() { _ = ptmx.Close() }()

	setupSignalHandler()

	// 4. 쉘 출력을 stdout(JSON)으로 전송 (UTF-8 잘림 방지 로직 포함)
	go func() {
		buf := make([]byte, 1024*64)
		remainder := []byte{}
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				// 이전 데이터와 합침
				data := append(remainder, buf[:n]...)
				
				// 유효한 UTF-8 경계 찾기
				lastValid := 0
				for i := 0; i < len(data); {
					if data[i] < 128 { // ASCII
						i++
						lastValid = i
						continue
					}
					
					r, size := utf8.DecodeRune(data[i:])
					if r == utf8.RuneError && size == 1 {
						// 불완전한 룬이면 중단하고 나머지는 다음으로 넘김
						if !utf8.FullRune(data[i:]) {
							break
						}
					}
					i += size
					lastValid = i
				}
				
				if lastValid > 0 {
					sendOutput(string(data[:lastValid]))
					remainder = data[lastValid:]
				} else {
					remainder = data
				}
			}
			if err != nil {
				if err == io.EOF {
					break
				}
				break
			}
		}
	}()

	// 5. stdin(JSON) 명령 처리
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var msg Message
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "input":
			// 한글 자모 분리 방지를 위해 NFC(Normalization Form Composed)로 정규화
			nfcData := norm.NFC.String(msg.Data)
			_, _ = ptmx.Write([]byte(nfcData))
		case "resize":
			_ = pty.Setsize(ptmx, &pty.Winsize{
				Cols: uint16(msg.Cols),
				Rows: uint16(msg.Rows),
			})
		}
	}

	err = c.Wait()
	exitCode := 0
	if err != nil {
		if exitError, ok := err.(*exec.ExitError); ok {
			exitCode = exitError.ExitCode()
		}
	}
	sendExit(exitCode)
}

func sendOutput(data string) {
	msg := Message{Type: "output", Data: data}
	printJSON(msg)
}

func sendExit(code int) {
	msg := Message{Type: "exit", Code: code}
	printJSON(msg)
}

func sendError(err error) {
	msg := Message{Type: "output", Data: fmt.Sprintf("\r\n[Bridge Error]: %v\r\n", err)}
	printJSON(msg)
}

func printJSON(msg Message) {
	b, _ := json.Marshal(msg)
	os.Stdout.Write(b)
	os.Stdout.Write([]byte("\n"))
}
