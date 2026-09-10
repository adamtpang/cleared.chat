#!/usr/bin/env bash
set -euo pipefail
NEW=${1:?Pass the built image tag}
[[ "$NEW" =~ ^[a-f0-9]{7,40}$ ]] || exit 2
docker image inspect "cleared-chat:$NEW" >/dev/null
OLD=$(docker inspect cleared-chat --format '{{.Config.Image}}')
[ "$OLD" != "cleared-chat:$NEW" ] || exit 0
BACKUP="cleared-chat-prev-${OLD##*:}-$(date +%s)"
ENVFILE=$(mktemp /root/.cleared-env.XXXXXX)
chmod 600 "$ENVFILE"
trap 'rm -f "$ENVFILE"' EXIT
docker inspect cleared-chat --format '{{range .Config.Env}}{{println .}}{{end}}' > "$ENVFILE"
docker stop -t 20 cleared-chat >/dev/null
docker rename cleared-chat "$BACKUP"
rollback() {
  docker stop -t 20 cleared-chat >/dev/null 2>&1 || true
  docker rename cleared-chat "cleared-chat-failed-$NEW-$(date +%s)" 2>/dev/null || true
  docker rename "$BACKUP" cleared-chat
  docker start cleared-chat >/dev/null
}
if ! docker run -d --name cleared-chat --restart unless-stopped \
  --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
  -p 127.0.0.1:4323:8080 -v /var/lib/cleared-chat:/data \
  --env-file "$ENVFILE" "cleared-chat:$NEW" >/dev/null; then
  rollback
  exit 1
fi
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4323/health >/dev/null; then
    echo "Healthy: cleared-chat:$NEW; rollback: $BACKUP"
    exit 0
  fi
  sleep 2
done
rollback
echo 'Health check failed; previous container restored' >&2
exit 1
