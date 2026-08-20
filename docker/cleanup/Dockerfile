FROM alpine:3.21@sha256:48b0309ca019d89d40f670aa1bc06e426dc0931948452e8491e3d65087abc07d

RUN apk add --no-cache curl
COPY docker/cleanup/cleanup.sh /usr/local/bin/cleanup.sh
RUN chmod +x /usr/local/bin/cleanup.sh

RUN addgroup -S cleanup && adduser -S cleanup -G cleanup
USER cleanup

ENTRYPOINT ["/usr/local/bin/cleanup.sh"]
