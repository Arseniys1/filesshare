FROM alpine:3.21

RUN apk add --no-cache curl
COPY docker/cleanup/cleanup.sh /usr/local/bin/cleanup.sh
RUN chmod +x /usr/local/bin/cleanup.sh

ENTRYPOINT ["/usr/local/bin/cleanup.sh"]
