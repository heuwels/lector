// Re-export of the shared language layer (`languages/`), the single source of
// truth shared with the Next client. Shipped into the API image via the
// Dockerfile `COPY languages ./languages` step (resolves to /app/languages).
export * from '../../../languages/registry';
export * from '../../../languages/text';
export * from '../../../languages/graphemes';
export * from '../../../languages/tokenizer';
