import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";

const root = join(import.meta.dirname, "..");
const entrypoint = join(root, "src/cli.ts");

const nativeTargets = [
  { target: "bun-darwin-arm64", output: "git-switchboard-darwin-arm64" },
  { target: "bun-darwin-x64", output: "git-switchboard-darwin-x64" },
  { target: "bun-linux-x64", output: "git-switchboard-linux-x64" },
  { target: "bun-linux-arm64", output: "git-switchboard-linux-arm64" },
  {
    target: "bun-windows-x64",
    output: "git-switchboard-windows-x64.exe",
  },
  {
    target: "bun-windows-arm64",
    output: "git-switchboard-windows-arm64.exe",
  },
] as const;

type NativeTarget = (typeof nativeTargets)[number]["target"];

const args = process.argv.slice(2).filter((a) => a !== "--");
const mode = args[0];

if (mode === "native") {
  await buildNative(args[1]);
} else {
  await buildNpm();
}

async function buildNpm() {
  const outdir = join(root, "dist");
  rmSync(outdir, { recursive: true, force: true });

  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir,
    target: "bun",
    naming: "git-switchboard.js",
    banner: "#!/usr/bin/env bun",
    external: ["@opentui/core", "@opentui/react", "react"],
  });

  exitIfFailed(result, "npm bundle");
  console.log("Built npm bundle to dist/");
}

async function buildNative(selected?: string) {
  const outdir = join(root, "native-builds");
  mkdirSync(outdir, { recursive: true });

  const targets = selected
    ? nativeTargets.filter(
        (t) => t.target === selected || t.output === selected
      )
    : [...nativeTargets];

  if (selected && targets.length === 0) {
    console.error(`Unknown target: ${selected}`);
    console.error(
      `Valid targets: ${nativeTargets.map((t) => t.target).join(", ")}`
    );
    process.exit(1);
  }

  for (const { target, output } of targets) {
    console.log(`Building ${output}...`);

    const result = await Bun.build({
      entrypoints: [entrypoint],
      compile: {
        target: target as NativeTarget,
        outfile: join(outdir, output),
      },
      minify: true,
    });

    exitIfFailed(result, output);
  }

  console.log(`Built ${targets.length} native binary(s).`);
}

function exitIfFailed(result: Awaited<ReturnType<typeof Bun.build>>, label: string) {
  if (!result.success) {
    console.error(`Build failed (${label}):`);
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }
}
