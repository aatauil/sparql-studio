import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;

export async function setup() {
  server = await createServer({ server: { port: 5174 } });
  await server.listen();
}

export async function teardown() {
  await server.close();
}
