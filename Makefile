# The one interface for building, testing and running tiaTube, locally and in CI. Everything runs in Docker.

IMAGE ?= tiatube:dev
PORT ?= 8765
DOCKER_BUILD = DOCKER_BUILDKIT=1 docker build

.PHONY: all web test image push run run-test stop clean ci

all: image

## web: the bundled web files into dist/web (the server embeds them; this target is for looking at them)
web:
	$(DOCKER_BUILD) --target web-out --output type=local,dest=dist/web .

## test: gofmt, go vet and the Go tests (with ffmpeg)
test:
	$(DOCKER_BUILD) --target test .

## image: the runtime image
image:
	$(DOCKER_BUILD) --target image -t $(IMAGE) .

## push: the image to its registry (IMAGE=<registry>/<name>:<tag>)
push: image
	docker push $(IMAGE)

## run: the image on http://127.0.0.1:$(PORT)/install, the way it runs in production (read-only, non-root)
run: image
	docker run --rm --init --name tiatube-dev --read-only -p 127.0.0.1:$(PORT):8765 -v tiatube-data:/data $(IMAGE)

## run-test: like run, with the test upload endpoint on
run-test: image
	docker run --rm --init --name tiatube-dev --read-only -p 127.0.0.1:$(PORT):8765 -v tiatube-data:/data -e TIATUBE_TEST=1 $(IMAGE)

## stop: stops a container of run / run-test
stop:
	docker stop tiatube-dev

## ci: what the CI runs
ci: test image

clean:
	rm -rf dist
