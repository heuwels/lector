// Runtime config for the browser. In production, docker-entrypoint.sh overwrites
// this at container start from the container's env (API_URL, LECTOR_MODE). This
// checked-in stub is the dev default: an empty object, so src/lib/api-base.ts
// falls back to http://localhost:3457 for the API and "selfhost" for the mode.
// Do not put secrets here — it's served to the browser.
window.__ENV__ = {};
