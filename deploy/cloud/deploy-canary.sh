#!/bin/bash
# Runs ON the canary instance, shipped over SSM by the deploy-canary job in
# .github/workflows/docker.yml on every master merge. The real work happens in
# /srv/lector/update.sh (written at first boot by the CDK user-data): refresh
# secrets from SSM Parameter Store, pull :latest, recreate the containers.
# This wrapper adds the health gate so the workflow goes red when the new
# image doesn't actually come up.
#
# Manual runbook equivalent (README.md → Operate):
#   aws ssm start-session --target <instance-id> → sudo /srv/lector/update.sh
set -euo pipefail

/srv/lector/update.sh

# Zero-ingress box: nothing listens on the host, so probe /health from inside
# the container (runner image is node:20 — fetch is built in).
for _ in $(seq 1 30); do
  if docker exec lector node -e 'fetch("http://localhost:3457/health").then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))' 2>/dev/null; then
    IMAGE_REF=$(docker inspect --format '{{.Config.Image}}' lector)
    DIGEST=$(docker image inspect "$IMAGE_REF" --format '{{index .RepoDigests 0}}' 2>/dev/null || echo "$IMAGE_REF (digest unknown)")
    echo "canary healthy: $DIGEST"
    exit 0
  fi
  sleep 3
done

echo "lector did not report healthy within 90s of update" >&2
docker logs --tail 50 lector >&2 || true
exit 1
