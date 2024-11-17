package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"log"
	"net/http"

	"github.com/TA-MoQ/quic-go"
	"github.com/TA-MoQ/quic-go/http3"
	"github.com/TA-MoQ/webtransport-go"
	"github.com/kixelated/invoker"
)

type Server struct {
	sessions invoker.Tasks
	inner    *webtransport.Server
}

type ServerConfig struct {
	Addr string
	Cert *tls.Certificate
}

func NewServer(config ServerConfig) (s *Server, err error) {
	s = new(Server)
	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{*config.Cert},
	}

	mux := http.NewServeMux()

	s.inner = &webtransport.Server{
		H3: http3.Server{
			TLSConfig: tlsConfig,
			Addr:      config.Addr,
			Handler:   mux,
		},
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		hijacker, ok := w.(http3.Hijacker)
		if !ok {
			panic("unable to hijack connection: must use kixelated/quic-go")
		}

		conn := hijacker.Connection()

		sess, err := s.inner.Upgrade(w, r)
		if err != nil {
			http.Error(w, "failed to upgrade session", 500)
			return
		}

		err = s.serve(r.Context(), conn, sess)
		if err != nil {
			log.Println(err)
		}
	})

	return s, nil
}

func (s *Server) runServe(ctx context.Context) (err error) {
	return s.inner.ListenAndServe()
}

func (s *Server) runShutdown(ctx context.Context) (err error) {
	<-ctx.Done()
	s.inner.Close()
	return ctx.Err()
}

func (s *Server) Run(ctx context.Context) (err error) {
	return invoker.Run(ctx, s.runServe, s.runShutdown, s.sessions.Repeat)
}

func (s *Server) serve(ctx context.Context, conn quic.Connection, sess *webtransport.Session) (err error) {
	defer func() {
		if err != nil {
			sess.CloseWithError(1, err.Error())
		} else {
			sess.CloseWithError(0, "end of broadcast")
		}
	}()

	ss, err := NewSession(conn, sess, s)
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}

	err = ss.Run(ctx)
	if err != nil {
		return fmt.Errorf("terminated session: %w", err)
	}

	return nil
}
