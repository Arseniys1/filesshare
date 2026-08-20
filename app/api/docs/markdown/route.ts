import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const content = await readFile(path.join(process.cwd(), "docs", "api.md"), "utf8");
  return new Response(content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": "inline; filename=filesshare-api.md",
      "Cache-Control": "public, max-age=300",
    },
  });
}
