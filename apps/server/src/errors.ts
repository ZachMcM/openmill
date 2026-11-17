type ErrorStatus = 400 | 404 | 409;

export class ApiError extends Error {
  readonly status: ErrorStatus;

  constructor(status: ErrorStatus, message: string) {
    super(message);
    this.status = status;
  }
}
