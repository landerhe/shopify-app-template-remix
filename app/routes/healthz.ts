import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async (_args: LoaderFunctionArgs) => {
  return new Response("ok", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};


