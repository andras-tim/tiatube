# syntax=docker/dockerfile:1
# Every build step of tiaTube; the Makefile calls its targets.

ARG GO_IMAGE=golang:1.26-alpine3.23
ARG RUNTIME_IMAGE=alpine:3.23

# ---- web: the window, the install page and the bookmarklet, bundled by esbuild ----
FROM ${GO_IMAGE} AS web
WORKDIR /src
COPY tools/go.mod tools/go.sum tools/
RUN cd tools && go mod download && go build -o /dev/null github.com/evanw/esbuild/cmd/esbuild
COPY tools/build-web.sh tools/
COPY sites.json ./
COPY poc poc
COPY web web
RUN tools/build-web.sh /out

FROM scratch AS web-out
COPY --from=web /out /

# ---- server ----
FROM ${GO_IMAGE} AS server-src
WORKDIR /src/server
COPY server/go.mod ./
COPY server/*.go ./
COPY --from=web /out web/

FROM server-src AS test
RUN apk add --no-cache ffmpeg gcc musl-dev
RUN test -z "$(gofmt -l .)" || { gofmt -l .; exit 1; }
RUN --mount=type=cache,target=/root/.cache/go-build go vet ./...
RUN --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=1 go test -race -count=1 ./...

FROM server-src AS server
RUN --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /tiatube .

# ---- runtime image ----
FROM ${RUNTIME_IMAGE} AS image
RUN apk add --no-cache ffmpeg \
 && adduser -D -H -u 10001 tiatube \
 && mkdir /data && chown tiatube /data
COPY --from=server /tiatube /usr/local/bin/tiatube
USER tiatube
ENV TIATUBE_DATA=/data
VOLUME /data
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8765/healthz || exit 1
ENTRYPOINT ["tiatube"]
