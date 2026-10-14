.PHONY: install build run lan test

ADDR ?= 127.0.0.1:8080
DATA ?= data

install:
	cd web && npm ci

build:
	cd web && npm run build
	go build -trimpath -o bin/teaparty ./cmd/teaparty

run:
	go run ./cmd/teaparty -addr $(ADDR) -data $(DATA)

lan:
	go run ./cmd/teaparty -addr 0.0.0.0:8080 -data $(DATA)

test:
	go test -race ./...
	cd web && npm test
	cd web && npm run typecheck
