FROM docker.io/library/ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PATH=/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ENV CARGO_BUILD_JOBS=1
ENV CARGO_PROFILE_RELEASE_LTO=off
ENV CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash \
      build-essential \
      ca-certificates \
      coreutils \
      curl \
      file \
      git \
      pkg-config \
      libssl-dev \
      tar \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal

WORKDIR /tmp/bootstrap
COPY .tonic-git-ref /tmp/bootstrap/.tonic-git-ref
COPY scripts/install-tonic.sh /tmp/bootstrap/scripts/install-tonic.sh
RUN chmod +x /tmp/bootstrap/scripts/install-tonic.sh \
    && bash /tmp/bootstrap/scripts/install-tonic.sh \
    && tonic --help >/dev/null

WORKDIR /work
