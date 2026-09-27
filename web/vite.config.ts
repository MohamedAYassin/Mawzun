// Plain TanStack Start stack — no editor wrapper.
//
// This used to import a site-builder's vite preset: a 50 KB wrapper that
// registered the plugins below plus editor-only extras (dev-server bridge, HMR
// gate, sandbox port/host detection, an error-logger plugin) that mean nothing
// outside that editor. Everything load-bearing is declared here explicitly, so
// the build is described by this file rather than by a third-party package's
// defaults.
//   tailwindcss, tsconfig paths, tanstackStart (SSR entry -> src/server.ts, SPA
//   shell prerender), viteReact (dev HMR), and build-only nitro compiling the
//   server to .output/server/index.mjs (wrangler.jsonc `main`).
// The prerender preview shim below is load-bearing: TanStack Start's SPA-shell
// prerender pass starts a `vite preview` server that imports dist/server/server.js,
// but nitro owns the real server build, so the shim writes a wrapper there that
// serves the nitro worker for the duration of the pass and deletes itself after.
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, mergeConfig, type ConfigEnv, type Plugin, type PluginOption, type UserConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

type NitroViteOptions = NonNullable<Parameters<typeof nitro>[0]>;
type StartViteOptions = NonNullable<Parameters<typeof tanstackStart>[0]>;

const NITRO_SERVER_ENTRY = "index.mjs";
const NITRO_WRANGLER_CONFIG = "wrangler.json";
const NITRO_DEFAULT_OUTPUT_DIR = ".output";
const SERVER_OUTPUT_DIR = "dist/server";
const PRERENDER_PREVIEW_HOST = "127.0.0.1";
const TSS_PRERENDERING_ENV = "TSS_PRERENDERING";
const SHIM_MARKER =
  "// Prerender preview shim: serves the nitro-built worker during TanStack Start's SPA-shell prerender pass; removed after the build.";

function prerenderShimSource(vars: Record<string, unknown>, entrySpecifier: string) {
  return `${SHIM_MARKER}
import server from "${entrySpecifier}";

const env = ${JSON.stringify(vars)};
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} };

export default {
  fetch(request) {
    // srvx's NodeRequest exposes \`ip\` as a getter-only accessor and nitro's
    // cloudflare module handler assigns to it; shadow it with a writable one.
    Object.defineProperty(request, "ip", { value: undefined, writable: true, configurable: true });
    return server.fetch(request, env, ctx);
  },
};
`;
}

function captureNitroServerDir(nitroOpts: NitroViteOptions) {
  const output: { serverDir?: string } = {};
  const hooks = nitroOpts.hooks ?? {};
  const userCompiled = hooks.compiled;
  nitroOpts.hooks = {
    ...hooks,
    compiled: async (nitro) => {
      const serverDir = nitro?.options?.output?.serverDir;
      if (typeof serverDir === "string") output.serverDir = serverDir;
      if (typeof userCompiled === "function") await userCompiled(nitro);
    },
  };
  return output;
}

function pinnedNitroServerDir(nitroOpts: NitroViteOptions) {
  const output = nitroOpts.output;
  const dir = typeof output?.dir === "string" ? output.dir : undefined;
  const serverDir = typeof output?.serverDir === "string" ? output.serverDir : undefined;
  const resolved = serverDir
    ? serverDir.replace(/\{\{\s*output\.dir\s*\}\}/g, dir ?? NITRO_DEFAULT_OUTPUT_DIR)
    : dir && join(dir, "server");
  return resolved && !resolved.includes("{{") ? resolved : undefined;
}

function previewServerOutputDir() {
  return SERVER_OUTPUT_DIR;
}

function nitroEmitDirs(dirs: {
  shimDir: string;
  entryDirs: string[];
  nitroOutput: { serverDir?: string };
}) {
  const found = [dirs.nitroOutput.serverDir, ...dirs.entryDirs].filter((dir): dir is string => !!dir);
  return [...new Set(found)];
}

function prerenderShimDirs(nitroOpts: NitroViteOptions) {
  const shimDir = previewServerOutputDir();
  const candidates = [pinnedNitroServerDir(nitroOpts), join(NITRO_DEFAULT_OUTPUT_DIR, "server"), shimDir];
  return {
    shimDir,
    entryDirs: [...new Set(candidates.filter((dir): dir is string => !!dir))],
    nitroOutput: captureNitroServerDir(nitroOpts),
  };
}

function prerenderPreviewShim(state: { file?: string }, dirs: ReturnType<typeof prerenderShimDirs>): Plugin {
  let root = process.cwd();
  let serverEntryName = "server";
  return {
    name: "prerender-preview-shim",
    apply: "build",
    config(userConfig: UserConfig) {
      const ssrBuild = userConfig.environments?.ssr?.build;
      const input = ssrBuild?.rolldownOptions?.input ?? ssrBuild?.rollupOptions?.input;
      if (typeof input === "string") serverEntryName = input;
    },
    configResolved(config) {
      root = config.root;
    },
    buildApp: {
      order: "post",
      handler: async () => {
        const { access, mkdir, readFile, writeFile } = await import("node:fs/promises");
        const exists = async (candidate: string) => {
          try {
            await access(candidate);
            return true;
          } catch {
            return false;
          }
        };
        const candidates = nitroEmitDirs(dirs);
        let entryDir: string | undefined;
        for (const candidate of candidates) {
          const resolved = resolve(root, candidate);
          if (await exists(join(resolved, NITRO_SERVER_ENTRY))) {
            entryDir = resolved;
            break;
          }
        }
        if (!entryDir) {
          console.warn(`[prerender] Cannot prerender: nitro's ${NITRO_SERVER_ENTRY} is in none of ${candidates.join(", ")}; prerendered routes will fall back to SSR.`);
          return;
        }
        const entryName = basename(serverEntryName, extname(serverEntryName));
        const wouldOutrankNitroEntry = entryName === "index" && dirs.shimDir === SERVER_OUTPUT_DIR;
        if (!entryName || wouldOutrankNitroEntry) {
          console.warn(`[prerender] Cannot prerender: the server entry "${serverEntryName}" would need a shim at ${dirs.shimDir}/index.js, which outranks nitro's own entry when publishing. Rename the entry to anything but \`index\`.`);
          return;
        }
        const shimDir = resolve(root, dirs.shimDir);
        const target = join(shimDir, `${entryName}.js`);
        const occupant = await readFile(target, "utf8").catch(() => undefined);
        if (occupant !== undefined && !occupant.startsWith(SHIM_MARKER)) {
          console.warn(`[prerender] Cannot prerender: ${entryName}.js already exists in ${dirs.shimDir} and was not written by this plugin.`);
          return;
        }
        let vars: Record<string, unknown> = {};
        try {
          const candidate = JSON.parse(await readFile(join(entryDir, NITRO_WRANGLER_CONFIG), "utf8"))?.vars;
          if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) vars = candidate;
        } catch {}
        const specifier = relative(shimDir, join(entryDir, NITRO_SERVER_ENTRY)).split(sep).join("/");
        await mkdir(shimDir, { recursive: true });
        await writeFile(target, prerenderShimSource(vars, specifier.startsWith(".") ? specifier : `./${specifier}`));
        state.file = target;
      },
    },
  };
}

function prerenderPreviewShimCleanup(state: { file?: string }): Plugin {
  return {
    name: "prerender-preview-shim-cleanup",
    apply: "build",
    enforce: "post",
    buildApp: {
      order: "post",
      handler: async () => {
        if (!state.file) return;
        const { rm } = await import("node:fs/promises");
        await rm(state.file, { force: true });
        state.file = undefined;
      },
    },
  };
}

function prerenderIsEnabled(startOptions: StartViteOptions) {
  const spa = startOptions.spa;
  if (spa && (spa.enabled ?? true)) return true;
  const prerender = startOptions.prerender;
  if (prerender?.enabled === false) return false;
  const pages = Array.isArray(startOptions.pages) ? startOptions.pages : [];
  return !!(prerender?.enabled ?? pages.some((page) => !!page?.prerender?.enabled));
}

export default defineConfig((env: ConfigEnv) => {
  const { command, mode } = env;
  const isDevBuild = command === "build" && mode === "development";

  const tanstackStartOptions = {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // Prerender the SPA shell; the deploy target remains the Cloudflare
    // Workers server bundle (nitro preset: cloudflare-module).
    spa: { enabled: true },
    importProtection: {
      behavior: "error" as const,
      client: { files: ["**/server/**"], specifiers: ["server-only"] },
    },
  };
  const prerenderEnabled = prerenderIsEnabled(tanstackStartOptions);

  const plugins: PluginOption[] = [tailwindcss(), tsConfigPaths({ projects: ["./tsconfig.json"] })];
  plugins.push(tanstackStart(tanstackStartOptions));

  if (command === "build") {
    const nitroOpts: NitroViteOptions = { defaultPreset: "cloudflare-module" };
    const nitroDirs = prerenderEnabled ? prerenderShimDirs(nitroOpts) : undefined;
    plugins.push(nitro(nitroOpts));
    if (prerenderEnabled && nitroDirs) {
      const shimState: { file?: string } = {};
      plugins.push(prerenderPreviewShim(shimState, nitroDirs), prerenderPreviewShimCleanup(shimState));
    }
  }

  plugins.push(viteReact());

  let envDefine: Record<string, string> = {};
  const loadedEnv = loadEnv(mode, process.cwd(), "VITE_");
  for (const [key, value] of Object.entries(loadedEnv)) envDefine[`import.meta.env.${key}`] = JSON.stringify(value);

  let config: UserConfig = {
    define: envDefine,
    ...(isDevBuild
      ? {
          environments: { client: { define: { "process.env.NODE_ENV": JSON.stringify("development") } } },
          esbuild: { keepNames: true },
        }
      : {}),
    css: { transformer: "lightningcss" },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    optimizeDeps: {
      include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
      ignoreOutdatedRequests: true,
    },
    plugins,
  };

  config = mergeConfig({ server: { host: "::", port: 8080 } }, config);

  if (env.isPreview && prerenderEnabled && process.env[TSS_PRERENDERING_ENV] === "true") {
    config = mergeConfig({ preview: { host: PRERENDER_PREVIEW_HOST, port: 0 } }, config);
  }

  // Watch debounce defaults: Windows watchers fire mid-write; a stability window
  // keeps `vite dev` from restarting on partially written files.
  const existingWatch = config.server?.watch ?? {};
  config = mergeConfig(config, {
    server: {
      watch: {
        ...existingWatch,
        awaitWriteFinish: { stabilityThreshold: 1_000, pollInterval: 100 },
      },
    },
  });

  return config;
});
