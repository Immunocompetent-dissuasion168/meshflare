FROM debian:13-slim
WORKDIR /app
ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get -qq update \
  && apt-get -qq install --no-install-recommends wget ca-certificates dbus jq python3 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /run/dbus /app/output

ARG VERSION=2026.6.880.0
RUN wget -O /usr/share/keyrings/cloudflare-warp-archive-keyring.asc https://pkg.cloudflareclient.com/pubkey.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.asc] https://pkg.cloudflareclient.com/ trixie main" \
     | tee /etc/apt/sources.list.d/cloudflare-client.list \
  && apt-get -qq update \
  && apt-get -qq install --no-install-recommends cloudflare-warp=$VERSION \
  && rm -rf /var/lib/apt/lists/*

COPY extract.sh /app/extract.sh
COPY server.py /app/server.py
RUN chmod +x /app/extract.sh

EXPOSE 8080
CMD ["python3", "/app/server.py"]
