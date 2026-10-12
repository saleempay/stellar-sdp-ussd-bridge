/** A fake fetch that records requests and answers from a route table. */
export interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  form?: Record<string, { value: string; filename?: string; type?: string }>;
}

export type Route = (req: Recorded) => { status: number; body?: unknown } | undefined;

export function fakeFetch(route: Route) {
  const calls: Recorded[] = [];
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {})) headers[k] = v;
    const rec: Recorded = { url: input, method: init?.method ?? 'GET', headers };
    if (typeof init?.body === 'string') rec.body = init.body;
    else if (init?.body instanceof FormData) {
      rec.form = {};
      for (const [k, v] of init.body.entries()) {
        if (typeof v === 'string') rec.form[k] = { value: v };
        else rec.form[k] = { value: await v.text(), filename: v.name, type: v.type };
      }
    }
    calls.push(rec);
    const r = route(rec) ?? { status: 404, body: { error: 'no route' } };
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchImpl, calls };
}
