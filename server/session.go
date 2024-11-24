package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/TA-MoQ/quic-go"
	"github.com/TA-MoQ/webtransport-go"
	"github.com/kixelated/invoker"
)

type Session struct {
	conn    quic.Connection
	inner   *webtransport.Session
	server  *Server
	streams invoker.Tasks
}

func NewSession(connection quic.Connection, session *webtransport.Session, server *Server) (s *Session, err error) {
	s = new(Session)
	s.server = server
	s.conn = connection
	s.inner = session
	return s, nil
}

func (s *Session) Run(ctx context.Context) (err error) {
	// Once we've validated the session, now we can start accessing the streams
	return invoker.Run(ctx, s.runAccept, s.runAcceptUni, s.streams.Repeat)
}

func (s *Session) runAccept(ctx context.Context) (err error) {
	for {
		stream, err := s.inner.AcceptStream(ctx)
		if err != nil {
			return fmt.Errorf("failed to accept bidirectional stream: %w", err)
		}

		// Warp doesn't utilize bidirectional streams so just close them immediately.
		// We might use them in the future so don't close the connection with an error.
		stream.CancelRead(1)
	}
}

func (s *Session) runAcceptUni(ctx context.Context) (err error) {
	for {
		stream, err := s.inner.AcceptUniStream(ctx)
		if err != nil {
			return fmt.Errorf("failed to accept unidirectional stream: %w", err)
		}

		s.streams.Add(func(ctx context.Context) (err error) {
			return s.handleStream(ctx, stream)
		})
	}
}

func (s *Session) handleStream(ctx context.Context, stream webtransport.ReceiveStream) (err error) {
	defer func() {
		if err != nil {
			stream.CancelRead(1)
		}
	}()

	var message [8]byte
	for {
		_, err = io.ReadFull(stream, message[:])
		if errors.Is(err, io.EOF) {
			return nil
		} else if err != nil {
			return fmt.Errorf("failed to read atom header: %w", err)
		}

		if string(message[0:8]) == "RUNTESTS" {
			go s.runFakeAudio(ctx)
			go s.runTests()
		}
	}
}

func (s *Session) runSingleTest(totalFragments int) {
	for testNum := range 100 {
		go func() {
			for fragmentNum := range totalFragments {
				var buf []byte
				t := time.Now().UnixMilli()
				buf = append(buf, uint8(totalFragments))
				buf = append(buf, uint8(testNum))
				buf = append(buf, uint8(fragmentNum))
				buf = append(buf, uint8(t>>24), uint8(t>>16), uint8(t>>8), uint8(t))
				buf = append(buf, strings.Repeat("a", 1200)...)

				s.inner.SendDatagram(buf)
			}
		}()
		time.Sleep(40 * time.Millisecond) // 1 PTS
	}
}

func (s *Session) runFakeAudio(ctx context.Context) error {
	stream, err := s.inner.OpenUniStreamSync(ctx)
	if err != nil {
		return fmt.Errorf("failed to open unidirectional stream: %w", err)
	}

	for {
		go stream.Write([]byte(strings.Repeat("a", 5500))) // ~128kbps
		time.Sleep(40 * time.Millisecond)                  // 1 PTS
	}
}

func (s *Session) runTests() {
	s.runSingleTest(10)
	s.runSingleTest(25)
	s.runSingleTest(50)
	s.runSingleTest(75)
	s.runSingleTest(100)
	s.runSingleTest(150)
	s.runSingleTest(200)
}
