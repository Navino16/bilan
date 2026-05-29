import { getAuth } from "@/server/auth";

async function handle(req: Request): Promise<Response> {
  const auth = await getAuth();
  return auth.handler(req);
}

export { handle as GET, handle as POST };
