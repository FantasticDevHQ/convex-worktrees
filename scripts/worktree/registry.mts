import type { Leases } from "./types.mts";
import fs from "node:fs/promises";

import path from "node:path";

import { createHash } from "node:crypto";

import net from "node:net";

import { root, registry, sleep, read } from "./context.mts";
import { json } from "./files.mts";

export function alive(pid: number | undefined) {
  if (!Number.isInteger(pid) || (pid ?? 0) < 2) return false;
  try {
    process.kill(pid!, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

export async function locked<T>(fn: (leases: Leases) => Promise<T>) {
  await fs.mkdir(registry, { recursive: true, mode: 0o700 });
  const lock = path.join(registry, "lock");
  const deadline = Date.now() + 30000;
  while (true) {
    try {
      await fs.mkdir(lock);
      await fs.writeFile(path.join(lock, "pid"), String(process.pid));
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number(
        await fs.readFile(path.join(lock, "pid"), "utf8").catch(() => "0"),
      );
      const age =
        Date.now() -
        (await fs.stat(lock).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs;
      if (age > 60000 && !alive(pid)) {
        await fs.rm(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline)
        throw new Error(`Timed out waiting for registry lock: ${lock}`);
      await sleep(80);
    }
  }
  try {
    const file = path.join(registry, "leases.json");
    const leases = await read<Leases>(file, {});
    const result = await fn(leases);
    await json(file, leases);
    return result;
  } finally {
    await fs.rm(lock, { recursive: true, force: true });
  }
}

export async function projectLock<T>(fn: () => T | Promise<T>, scope = root) {
  await fs.mkdir(registry, { recursive: true, mode: 0o700 });
  const lock = path.join(
    registry,
    `operation-${createHash("sha256").update(scope).digest("hex").slice(0, 24)}`,
  );
  const deadline = Date.now() + 180000;
  while (true) {
    try {
      await fs.mkdir(lock);
      await fs.writeFile(path.join(lock, "pid"), String(process.pid));
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number(
        await fs.readFile(path.join(lock, "pid"), "utf8").catch(() => "0"),
      );
      const age =
        Date.now() -
        (await fs.stat(lock).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs;
      if (age > 60000 && !alive(pid)) {
        await fs.rm(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline)
        throw new Error(
          "Another lifecycle operation is still running for this checkout.",
        );
      await sleep(100);
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lock, { recursive: true, force: true });
  }
}

export async function available(port: number) {
  // On macOS an IPv6 bind can succeed alongside an IPv4 listener. Probe the
  // actual loopback endpoint and both address families before reserving a port.
  const connected = await new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(true);
    });
  });
  if (connected) return false;
  for (const host of ["0.0.0.0", "::"]) {
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", (error) =>
        resolve(
          (error as NodeJS.ErrnoException).code === "EAFNOSUPPORT" || (error as NodeJS.ErrnoException).code === "EADDRNOTAVAIL",
        ),
      );
      server.listen({ port, host, exclusive: true }, () =>
        server.close(() => resolve(true)),
      );
    });
    if (!free) return false;
  }
  return true;
}
