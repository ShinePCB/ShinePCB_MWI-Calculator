/* Local static calculator preview. GPL-3.0-or-later */
import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = await realpath(fileURLToPath(new URL("../dist/", import.meta.url)));
const port = Number(process.env.PORT || 18771);
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".pdf": "application/pdf" };
const server = createServer(async (req, res) => {
  try {
    if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname.includes("\\") || pathname.includes("\0")) throw new Error("Invalid path");
    const candidate = path.resolve(root, "." + pathname, pathname.endsWith("/") ? "index.html" : "");
    const target = await realpath(candidate);
    if (!target.startsWith(root + path.sep) || !(await stat(target)).isFile()) throw new Error("Not found");
    const data = await readFile(target);
    res.writeHead(200, { "Content-Type": mime[path.extname(target)] ?? "application/octet-stream", "Content-Length": data.length, "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); }
});
server.listen(port, "127.0.0.1", () => console.log(`ShinePCB_MWI Calculator: http://127.0.0.1:${port}`));
