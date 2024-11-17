package main

import (
	"context"
	"crypto/tls"
	"flag"
	"fmt"
	"log"

	"github.com/kixelated/invoker"
)

func main() {
	err := run(context.Background())
	if err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) (err error) {
	addr := flag.String("addr", ":4443", "HTTPS server address")
	//server deploy env
	cert := flag.String("tls-cert", "/etc/letsencrypt/live/dickyarian.blue/fullchain.pem", "TLS certificate file path")
	key := flag.String("tls-key", "/etc/letsencrypt/live/dickyarian.blue/privkey.pem", "TLS certificate file path")
	flag.Parse()

	tlsCert, err := tls.LoadX509KeyPair(*cert, *key)
	if err != nil {
		return fmt.Errorf("failed to load TLS certificate: %w", err)
	}

	config := ServerConfig{
		Addr: *addr,
		Cert: &tlsCert,
	}

	ws, err := NewServer(config)
	if err != nil {
		return fmt.Errorf("failed to create warp server: %w", err)
	}

	log.Printf("listening on %s", *addr)

	return invoker.Run(ctx, invoker.Interrupt, ws.Run)
}
