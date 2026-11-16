# syntax=docker/dockerfile:1
# Every build step of tiaTube; the Makefile calls its targets.

ARG GO_IMAGE=golang:1.26-alpine3.23
ARG RUNTIME_IMAGE=alpine:3.23
ARG PY_IMAGE=python:3.14-slim

# ---- assets: the logos (from sites.json and the fonts) and the install page background; committed under assets/ ----
FROM ${PY_IMAGE} AS assets
WORKDIR /src
COPY tools/assets/requirements.txt tools/assets/
RUN pip install --no-cache-dir -r tools/assets/requirements.txt
ADD --checksum=sha256:bc31e0b0583e8530795907883e768597bf7bdb4e47a65861dc393b4411439e22 \
    https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8SKtjPQ.ttf \
    /fonts/JetBrainsMono-ExtraBold.ttf
ADD --checksum=sha256:20987dd8fd1d3e9ab087a55cb90e98081c873c729c113043e0bfb1ef0f9e0bd7 \
    https://fonts.gstatic.com/s/oswald/v57/TK3_WkUHHAIjg75cFRf3bXL8LICs1y9ogUE.ttf \
    /fonts/Oswald-SemiBold.ttf
COPY tools/assets/*.py tools/assets/
COPY sites.json ./
COPY screenshots/downloaded.png screenshots/
RUN python3 -I tools/assets/logo.py --sites sites.json --fonts /fonts --out /out/logos \
 && python3 -I tools/assets/background.py screenshots/downloaded.png /out/old-page.webp

FROM scratch AS assets-out
COPY --from=assets /out /

# ---- web: the window, the install page and the bookmarklet, bundled by esbuild ----
FROM ${GO_IMAGE} AS web
WORKDIR /src
COPY tools/go.mod tools/go.sum tools/
RUN cd tools && go mod download && go build -o /dev/null github.com/evanw/esbuild/cmd/esbuild
COPY tools/build-web.sh tools/
COPY sites.json ./
COPY assets assets
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
ARG VERSION=dev
RUN --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 go build -trimpath \
    -ldflags="-s -w -X main.release=${VERSION}" -o /tiatube .

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
