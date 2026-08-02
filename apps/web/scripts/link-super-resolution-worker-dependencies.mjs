import { access, readlink, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeModules = path.join(appDir, ".next", "standalone", "node_modules");

for (const packageName of ["onnxruntime-node", "sharp"]) {
  const source = path.join(".pnpm", "node_modules", packageName);
  const sourcePath = path.join(nodeModules, source);
  const destination = path.join(nodeModules, packageName);
  await access(sourcePath);

  try {
    const existingTarget = await readlink(destination);
    if (existingTarget !== source) {
      throw new Error(
        `${destination} points to ${existingTarget}; expected ${source}`
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "EINVAL") throw error;
    if (error?.code === "EINVAL") {
      throw new Error(`${destination} exists and is not a symbolic link`);
    }
    await symlink(source, destination, "dir");
  }
}

console.info("Linked standalone dependencies for the super-resolution worker");
