/**
 * Turns the live route table plus the hand-written annotations into an
 * OpenAPI 3.1 document. Pure: it reads no files and touches no database, so
 * the unit tests can drive it directly.
 */
import { collectEndpoints, endpointKey, type Endpoint } from './endpoints';
import {
  extraEndpoints,
  info,
  operations,
  parameters,
  schemas,
  servers,
  tags,
  type JsonSchema,
  type OperationDoc,
} from './annotations';

export interface BuildOptions {
  /** Include the browser-only and operator-only endpoints. Default false. */
  includeInternal?: boolean;
}

export interface DriftReport {
  /** Routes the app serves that `annotations.ts` does not document. */
  undocumented: string[];
  /** Annotation keys that no route serves. */
  stale: string[];
  /** Documented operations whose success response carries no schema. */
  schemaless: string[];
}

export interface BuildResult {
  document: Record<string, unknown>;
  drift: DriftReport;
  /** Endpoints in the document, after the visibility filter. */
  included: Endpoint[];
}

const SECURITY_SCHEMES: Record<string, JsonSchema> = {
  PersonalAccessToken: {
    type: 'http',
    scheme: 'bearer',
    description:
      'A personal access token from Settings, sent as `Authorization: Bearer <token>`. The token needs the scope named on the endpoint.',
  },
  SessionCookie: {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
    description: 'The session cookie of the browser client. Lector Cloud only.',
  },
};

/** Errors every authenticated endpoint can answer with. */
const SHARED_ERRORS: Record<string, JsonSchema> = {
  '401': {
    description: 'The credential is missing, invalid or expired.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
  '403': {
    description: 'The token does not carry the scope this endpoint needs.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
  '429': {
    description: 'A plan limit or a rate limit stopped the call.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/PlanLimitError' } } },
  },
  '500': {
    description: 'The API failed.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
};

/** `GET /api/vocab/{id}` -> `getApiVocabById`. Stable, so client generators stay stable. */
export function operationId(method: string, path: string): string {
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((segment) => (segment.startsWith('{') ? `by-${segment.slice(1, -1)}` : segment))
    .join('-');
  const camel = `${method.toLowerCase()}-${parts}`.replace(/[^a-zA-Z0-9]+(.)?/g, (_, next) =>
    next ? next.toUpperCase() : '',
  );
  return camel;
}

/** True when the endpoint belongs in the published document. */
export function isPublic(endpoint: Endpoint, doc: OperationDoc | undefined): boolean {
  if (doc?.visibility) return doc.visibility === 'public';
  return endpoint.scope !== null;
}

function buildParameters(endpoint: Endpoint, doc: OperationDoc): JsonSchema[] {
  const result: JsonSchema[] = [];

  for (const name of endpoint.pathParams) {
    result.push({
      name,
      in: 'path',
      required: true,
      description: doc.pathParams?.[name] ?? `The \`${name}\` path parameter.`,
      schema: { type: 'string' },
    });
  }

  for (const name of doc.sharedParams ?? []) {
    const shared = parameters[name];
    if (!shared) throw new Error(`Unknown shared parameter "${name}" on ${endpointKey(endpoint)}`);
    result.push({ $ref: `#/components/parameters/${name}` });
  }

  for (const param of doc.query ?? []) {
    result.push({
      name: param.name,
      in: 'query',
      required: param.required ?? false,
      description: param.description,
      schema: param.schema,
    });
  }

  return result;
}

function buildOperation(endpoint: Endpoint, doc: OperationDoc): JsonSchema {
  const responses: Record<string, JsonSchema> = {};
  for (const [status, response] of Object.entries(doc.responses ?? {})) {
    responses[status] = {
      description: response.description,
      ...(response.schema
        ? { content: { [response.contentType ?? 'application/json']: { schema: response.schema } } }
        : {}),
    };
  }
  if (!doc.responses) {
    responses['200'] = { description: 'The call succeeded.' };
  }
  if (doc.requestBody && !responses['400']) {
    responses['400'] = {
      description: 'The body is malformed, or a field is not valid.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    };
  }
  if (endpoint.pathParams.length > 0 && !responses['404']) {
    responses['404'] = {
      description: 'No such record, in this account and language.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    };
  }
  const authenticated = (doc.auth ?? 'token') === 'token';
  if (authenticated) {
    for (const [status, response] of Object.entries(SHARED_ERRORS)) {
      responses[status] ??= response;
    }
  }

  const parametersList = buildParameters(endpoint, doc);

  return {
    operationId: operationId(endpoint.method, endpoint.path),
    summary: doc.summary,
    ...(doc.description ? { description: doc.description } : {}),
    tags: [doc.tag],
    ...(doc.deprecated ? { deprecated: true } : {}),
    ...(parametersList.length > 0 ? { parameters: parametersList } : {}),
    ...(doc.requestBody
      ? {
          requestBody: {
            required: doc.requestBody.required ?? false,
            ...(doc.requestBody.description ? { description: doc.requestBody.description } : {}),
            content: {
              [doc.requestBody.contentType ?? 'application/json']: {
                schema: doc.requestBody.schema,
              },
            },
          },
        }
      : {}),
    responses,
    ...(authenticated
      ? {
          security: [{ PersonalAccessToken: [] }, { SessionCookie: [] }],
          ...(endpoint.scope ? { 'x-token-scope': endpoint.scope } : {}),
        }
      : { security: [] }),
  };
}

export function buildDocument(options: BuildOptions = {}): BuildResult {
  const endpoints = [
    ...collectEndpoints(),
    ...extraEndpoints.map((extra) => ({
      method: extra.method,
      path: extra.path,
      honoPath: extra.path,
      pathParams: [],
      resource: null,
      scope: null,
    })),
  ];

  const documentedKeys = new Set(Object.keys(operations));
  const servedKeys = new Set(endpoints.map(endpointKey));

  const drift: DriftReport = {
    undocumented: [...servedKeys].filter((key) => !documentedKeys.has(key)).sort(),
    stale: [...documentedKeys].filter((key) => !servedKeys.has(key)).sort(),
    schemaless: [],
  };

  const paths: Record<string, Record<string, JsonSchema>> = {};
  const included: Endpoint[] = [];

  for (const endpoint of endpoints.sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  )) {
    const doc = operations[endpointKey(endpoint)];
    if (!doc) continue;
    if (!options.includeInternal && !isPublic(endpoint, doc)) continue;

    const hasSuccessSchema = Object.entries(doc.responses ?? {}).some(
      ([status, response]) => status.startsWith('2') && response.schema,
    );
    if (!hasSuccessSchema) drift.schemaless.push(endpointKey(endpoint));

    paths[endpoint.path] ??= {};
    paths[endpoint.path][endpoint.method.toLowerCase()] = buildOperation(endpoint, doc);
    included.push(endpoint);
  }

  const document = {
    openapi: '3.1.0',
    info,
    servers,
    tags: tags.filter((tag) =>
      included.some((endpoint) => operations[endpointKey(endpoint)]?.tag === tag.name),
    ),
    security: [{ PersonalAccessToken: [] }, { SessionCookie: [] }],
    paths,
    components: {
      securitySchemes: SECURITY_SCHEMES,
      parameters,
      schemas,
    },
  };

  return { document, drift, included };
}
