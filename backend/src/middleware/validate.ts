import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodTypeAny } from 'zod';

type Schemas = {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
};

export function validate(schemas: Schemas | AnyZodObject) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if ('parse' in schemas && typeof (schemas as AnyZodObject).parse === 'function' && !('body' in schemas)) {
        (schemas as AnyZodObject).parse({
          body: req.body,
          query: req.query,
          params: req.params,
        });
      } else {
        const s = schemas as Schemas;
        if (s.body) req.body = s.body.parse(req.body);
        if (s.query) req.query = s.query.parse(req.query) as typeof req.query;
        if (s.params) req.params = s.params.parse(req.params) as typeof req.params;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
