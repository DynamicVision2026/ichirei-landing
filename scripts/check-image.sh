#!/usr/bin/env bash
# Build the production image and start it: the container must boot and answer /api/health on port 8080. Run it before pushing any part that touches the
# server (engine/, api/, server/, Dockerfile): the image carries only the folders the Dockerfile copies, so a server file importing from a folder it
# leaves out passes every local test and then fails to start on Cloud Run.
#
#   scripts/check-image.sh
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/check-server-imports.mjs
TAG=ichirei-check:local
NAME=ichirei-check-$$
# Where the machine cannot reach the Debian mirrors or the npm registry (a sandbox behind a proxy), OFFLINE=1 builds only the RUNTIME stage from the same
# Dockerfile, with the host's node_modules and dist (run `npm run build` first) in place of `npm ci` / the build stage / the apt step. That still proves the
# image boots with exactly the folders the Dockerfile copies (the failure that matters: a server file importing from a folder the image leaves out); the apt
# and npm steps are proven by Cloud Build itself.
DF=Dockerfile
if [ "${OFFLINE:-0}" = 1 ]; then
  [ -d dist ] || { echo "run npm run build first"; exit 1; }
  DF=.Dockerfile.check
  python3 - <<'PY'
import re
s = open('Dockerfile').read()
runtime = s[s.index('FROM node:22-slim AS runtime'):]
runtime = re.sub(r"RUN apt-get update[^\n]*\n(?:  [^\n]*\n)*", "", runtime, count=1)
runtime = re.sub(r"RUN npm ci[^\n]*\n", "COPY node_modules ./node_modules\n", runtime, count=1)
runtime = runtime.replace('COPY --from=build /app/dist ./dist', 'COPY dist ./dist')
open('.Dockerfile.check', 'w').write(runtime)
open('.Dockerfile.check.dockerignore', 'w').write('.git\nshots\n')
PY
  trap 'rm -f .Dockerfile.check .Dockerfile.check.dockerignore' RETURN
fi
docker build --network host -f "$DF" -t "$TAG" .
rm -f .Dockerfile.check .Dockerfile.check.dockerignore
NAME=ichirei-check-$$
docker run -d --rm --name "$NAME" -p 8080:8080 -e PORT=8080 "$TAG" > /dev/null
trap 'docker logs "$NAME" 2>&1 | tail -20 || true; docker stop "$NAME" > /dev/null 2>&1 || true' EXIT
for i in $(seq 1 40); do
  if code=$(curl -s -o /tmp/ichirei-health.json -w '%{http_code}' http://127.0.0.1:8080/api/health) && [ "$code" = 200 ]; then
    echo "OK: /api/health answered 200 on :8080"; cat /tmp/ichirei-health.json; echo
    docker exec "$NAME" ffmpeg -version 2>&1 | head -1 || true
    exit 0
  fi
  docker ps -q -f "name=$NAME" | grep -q . || { echo "FAIL: the container exited"; exit 1; }
  sleep 1
done
echo "FAIL: /api/health did not answer within 40 s"; exit 1
