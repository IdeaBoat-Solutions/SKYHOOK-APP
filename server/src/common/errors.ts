/** RFC 9457 Problem Details. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly type: string,
    public readonly title: string,
    public readonly detail?: string,
    public readonly errors?: Array<{ field: string; message: string }>,
  ) {
    super(detail ?? title);
  }
}

export const Errors = {
  badRequest: (detail: string) => new ApiError(400, 'bad-request', 'Bad request', detail),
  unauthorized: (detail = 'Authentication required') =>
    new ApiError(401, 'unauthorized', 'Unauthorized', detail),
  forbidden: (detail = 'Insufficient permission') =>
    new ApiError(403, 'forbidden', 'Forbidden', detail),
  notFound: (entity: string) =>
    new ApiError(404, 'not-found', 'Not found', `${entity} not found`),
  conflict: (detail: string) => new ApiError(409, 'conflict', 'Conflict', detail),
  validation: (errors: Array<{ field: string; message: string }>) =>
    new ApiError(422, 'validation-failed', 'Validation failed', undefined, errors),
  locked: (detail = 'Resource is locked') =>
    new ApiError(409, 'resource-locked', 'Resource is locked', detail),
};

export function problemBody(err: ApiError, requestId: string, instance: string) {
  return {
    type: `https://errors.skyhook.example/${err.type}`,
    title: err.title,
    status: err.status,
    detail: err.detail,
    instance,
    requestId,
    ...(err.errors ? { errors: err.errors } : {}),
  };
}
