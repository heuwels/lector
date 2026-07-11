#!/usr/bin/env bash
# Reclaim disk on the Lector cloud boxes by removing Docker images that are no
# longer used by a running container. This is the manual escape hatch; steady
# state, update.sh prunes on every deploy (see canary-stack.ts).
#
# SAFE BY DESIGN:
#   * `docker image prune -a` never removes an image an in-use container needs,
#     so the live app (and cloudflared) are untouched.
#   * Anything it does remove — old sha-<commit> images and the moving `latest`
#     tag — is immutable and re-pullable from ghcr.io/heuwels/lector.
#   * Read-only until the prune line; prints df before and after.
#
# These boxes are zero-ingress (no SSH), so this drives them over SSM — run it
# from your laptop with the `lector` AWS profile.
#
# Usage:
#   deploy/cloud/prune-images.sh              # both boxes (default)
#   deploy/cloud/prune-images.sh staging      # staging.lector.dev only
#   deploy/cloud/prune-images.sh production   # app.lector.dev only
#
# Requires: awscli v2, jq. Override AWS_PROFILE / AWS_REGION via env if needed.
set -euo pipefail

export AWS_PROFILE=${AWS_PROFILE:-lector}
export AWS_REGION=${AWS_REGION:-us-east-1}

target=${1:-both}

stack_for() {
  case "$1" in
    staging)    echo cloud-staging ;;   # staging.lector.dev
    production) echo cloud-canary ;;    # app.lector.dev (canary-era tag)
    *) echo "unknown deployment: $1" >&2; return 1 ;;
  esac
}

# Resolve the single running instance for a stack by tag — no hardcoded IDs,
# same filter the deploy workflow uses.
instance_for() {
  local stack=$1 id
  id=$(aws ec2 describe-instances \
    --filters "Name=tag:project,Values=lector" \
              "Name=tag:stack,Values=$stack" \
              "Name=instance-state-name,Values=running" \
    --query 'Reservations[].Instances[].InstanceId' --output text)
  if [ "$(echo "$id" | wc -w)" -ne 1 ]; then
    echo "expected exactly one running $stack instance, got: '$id'" >&2
    return 1
  fi
  echo "$id"
}

# What actually runs on the box.
REMOTE='
set -e
echo "-- disk before --"; df -h / | tail -1
docker image prune -a -f
echo "-- disk after --";  df -h / | tail -1
echo "-- images kept --"
docker images ghcr.io/heuwels/lector --format "{{.Tag}}  {{.Size}}"
'

prune_one() {
  local deployment=$1 stack instance cmd status
  stack=$(stack_for "$deployment")
  instance=$(instance_for "$stack")
  echo "==> $deployment ($instance)"
  cmd=$(aws ssm send-command \
    --instance-ids "$instance" \
    --document-name AWS-RunShellScript \
    --comment "manual lector image prune" \
    --parameters "$(jq -Rn --arg s "$REMOTE" '{commands:[$s],executionTimeout:["300"]}')" \
    --query Command.CommandId --output text)
  status=Pending
  for _ in $(seq 1 60); do
    status=$(aws ssm get-command-invocation --command-id "$cmd" \
      --instance-id "$instance" --query Status --output text 2>/dev/null || echo Pending)
    case "$status" in Pending|InProgress|Delayed) sleep 3 ;; *) break ;; esac
  done
  aws ssm get-command-invocation --command-id "$cmd" \
    --instance-id "$instance" --query StandardOutputContent --output text
  aws ssm get-command-invocation --command-id "$cmd" \
    --instance-id "$instance" --query StandardErrorContent --output text >&2
  echo "status: $status"
  [ "$status" = Success ]
}

case "$target" in
  both) prune_one staging; prune_one production ;;
  staging|production) prune_one "$target" ;;
  *) echo "usage: $0 [staging|production|both]" >&2; exit 2 ;;
esac
