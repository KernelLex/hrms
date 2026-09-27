import { dispatch } from "@/lib/api";

/**
 * The integration API, version 1. One handler for every path: the router in
 * src/lib/api matches the endpoint, authenticates the client and applies the
 * contract. The guide for the ERP's developers is API.md.
 */
export const dynamic = "force-dynamic";

async function handle(req: Request, ctx: RouteContext<"/api/v1/[...path]">): Promise<Response> {
  const { path } = await ctx.params;
  return dispatch(req, `/${path.join("/")}`);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
