// Re-export of the shared language registry (`languages/registry.ts`), the single
// source of truth shared with the Next client. Shipped into the API image via the
// Dockerfile `COPY languages ./languages` step (resolves to /app/languages).
export * from '../../../languages/registry';
