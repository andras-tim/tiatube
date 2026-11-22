# The one interface for building, testing and running tiaTube, locally and in CI. Everything runs in Docker.

IMAGE ?= tiatube:dev
# the release the install page shows: major.minor of the last tag (v3.0.0 -> v3.0)
VERSION ?= $(or $(shell git describe --tags --abbrev=0 2>/dev/null | cut -d. -f1,2),dev)
PORT ?= 8765
DOCKER_BUILD = DOCKER_BUILDKIT=1 docker build

.PHONY: all assets check-assets web check-bookmarklet test image push run run-test stop clean ci

all: image

## assets: regenerates assets/ (logos, install page background); commit the result
assets:
	$(DOCKER_BUILD) --target assets-out --output type=local,dest=assets .

## check-assets: fails when assets/ is not what its sources make
check-assets:
	rm -rf dist/assets
	$(DOCKER_BUILD) --target assets-out --output type=local,dest=dist/assets .
	diff -r assets dist/assets

## web: the bundled web files into dist/web (the server embeds them; this target is for looking at them)
web:
	$(DOCKER_BUILD) --target web-out --output type=local,dest=dist/web .

## check-bookmarklet: fails when the bookmarklet's build changed without a new number (BOOKMARKLET in
## web/shared/protocol.js): the last line of web/bookmarklet/builds.txt must be the number and the build
check-bookmarklet: web
	@n=$$(sed -n 's/^export const BOOKMARKLET = \([0-9][0-9]*\);$$/\1/p' web/shared/protocol.js); \
	b=$$(sha256sum dist/web/bookmarklet.js | cut -c1-8); \
	last=$$(tail -n 1 web/bookmarklet/builds.txt); \
	if [ "$$last" != "$$n $$b" ] || [ "$$(grep -c "^$$n " web/bookmarklet/builds.txt)" != 1 ]; then \
	  echo "check-bookmarklet: the build is $$b under number $$n, web/bookmarklet/builds.txt ends with '$$last'"; \
	  echo "a changed bookmarklet: raise BOOKMARKLET, make web, then add the line '<number> <build>'"; \
	  exit 1; \
	fi

## test: gofmt, go vet and the Go tests (with ffmpeg)
test:
	$(DOCKER_BUILD) --target test .

## image: the runtime image
image:
	$(DOCKER_BUILD) --target image --build-arg VERSION=$(VERSION) -t $(IMAGE) .

## push: the image to its registry (IMAGE=<registry>/<name>:<tag>)
push: image
	docker push $(IMAGE)

## run: the image on http://127.0.0.1:$(PORT)/, the way it runs in production (read-only, non-root)
run: image
	docker run --rm --init --name tiatube-dev --read-only -p 127.0.0.1:$(PORT):8765 -v tiatube-data:/data $(IMAGE)

## run-test: like run, with the test upload endpoint on
run-test: image
	docker run --rm --init --name tiatube-dev --read-only -p 127.0.0.1:$(PORT):8765 -v tiatube-data:/data -e TIATUBE_TEST=1 $(IMAGE)

## stop: stops a container of run / run-test
stop:
	docker stop tiatube-dev

## ci: what the CI runs
ci: check-assets check-bookmarklet test image

clean:
	rm -rf dist
