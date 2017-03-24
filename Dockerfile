FROM ubuntu:xenial

ARG DEBIAN_FRONTEND='noninteractive'
ARG APT_OPTIONS='--no-upgrade --no-install-recommends -y -q'
ARG TIMEZONE='Europe/Budapest'

RUN set -xe \

    # SYSTEM: use proper sources
    && for suite in 'xenial' 'xenial-updates' 'xenial-backports' 'xenial-security'; \
        do \
            echo "deb http://archive.ubuntu.com/ubuntu/ ${suite} main restricted universe multiverse"; \
        done > '/etc/apt/sources.list' \

    # SYSTEM: re-create apt cache
    && apt-get update \

    # SYSTEM: fix apt
    && apt-get install ${APT_OPTIONS} \
        apt-utils \

    # SYSTEM: set locales
    && apt-get install ${APT_OPTIONS} \
        language-pack-en \
        language-pack-hu \

    # SYSTEM: set timezone
    && cp -vf "/usr/share/zoneinfo/${TIMEZONE}" '/etc/localtime' \
    && echo "${TIMEZONE}" | tee '/etc/timezone' \

    # APP: install deb requirements
    && apt-get install ${APT_OPTIONS} \
        ffmpeg \
        imagemagick \
        libmp3lame0 \
        php-cli \
        python \
        python-pip \

    # APP: install python requirements
    && pip install --upgrade \
        pip \
        setuptools \
        wheel \
    && pip install --upgrade \
        eyed3 \
        iconv \
        youtube_dl \

    # SYSTEM: cleanup apt
    && apt-get clean

# APP: install
COPY ./tiatube/ /opt/tiatube/

# APP: configure
RUN set -xe \

    && mkdir '/etc/tiatube' \
    && ln -s '/etc/tiatube/config.js' '/opt/tiatube/www/js/config.js'

ENV LANG='en_US.UTF-8' \
    LANGUAGE='en_US:en' \
    LC_ALL='en_US.UTF-8'

EXPOSE 80
VOLUME  ["/etc/tiatube"]

WORKDIR "/opt/tiatube"
ENTRYPOINT ["./docker-entrypoint.sh"]
