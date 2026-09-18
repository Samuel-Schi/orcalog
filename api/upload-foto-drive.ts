import type { HandlerContext, HandlerEvent, HandlerResponse } from '@netlify/functions';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handler } from '../netlify/functions/upload-foto-drive';

type UploadRequest = IncomingMessage & { body?: unknown };

export default async function uploadFotoDrive(request: UploadRequest, response: ServerResponse) {
  const body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {});
  const result = await handler({
    httpMethod: request.method || 'GET',
    body: request.method === 'POST' ? body : null,
    isBase64Encoded: false
  } as HandlerEvent, {} as HandlerContext) as HandlerResponse | undefined;

  response.statusCode = result?.statusCode || 500;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(result?.body || '{}');
}
