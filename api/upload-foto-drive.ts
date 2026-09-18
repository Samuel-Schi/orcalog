import type { HandlerContext, HandlerEvent, HandlerResponse } from '@netlify/functions';
import { handler } from '../netlify/functions/upload-foto-drive';

export default {
  async fetch(request: Request): Promise<Response> {
    const result = await handler({
      httpMethod: request.method,
      body: request.method === 'POST' ? await request.text() : null,
      isBase64Encoded: false
    } as HandlerEvent, {} as HandlerContext) as HandlerResponse | undefined;

    return new Response(result?.body || '{}', {
      status: result?.statusCode || 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
};
