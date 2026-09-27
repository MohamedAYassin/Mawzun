import type { NextFunction, RequestHandler, Response } from "express";
import { ok } from "./http.js";
import type { AuthedRequest } from "./request.js";

/**
 * Binds a controller method to a route.
 *
 * The controller returns domain data; the envelope, the status code and the
 * async rejection are all handled here. That keeps error responses identical
 * across every endpoint and stops controllers from depending on `Response`.
 */
export function route<T>(
  fn: (req: AuthedRequest) => Promise<T> | T,
  options: { message?: string; status?: number } = {}
): RequestHandler {
  return (req, res: Response, next: NextFunction) => {
    void Promise.resolve()
      .then(() => fn(req as AuthedRequest))
      .then((data) => {
        if (data === null || data === undefined) {
          res.status(204).send();
          return;
        }
        ok(res, data, options.message, options.status ?? 200);
      })
      .catch(next);
  };
}

/**
 * Same as `route()` for handlers that must write cookies: the handler receives
 * `(req, res)` and everything else (envelope, status, async rejection) behaves
 * identically.
 */
export function routeWithRes<T>(
  fn: (req: AuthedRequest, res: Response) => Promise<T> | T,
  options: { message?: string; status?: number } = {}
): RequestHandler {
  return (req, res: Response, next: NextFunction) => {
    void Promise.resolve()
      .then(() => fn(req as AuthedRequest, res))
      .then((data) => {
        if (data === null || data === undefined) {
          res.status(204).send();
          return;
        }
        ok(res, data, options.message, options.status ?? 200);
      })
      .catch(next);
  };
}
