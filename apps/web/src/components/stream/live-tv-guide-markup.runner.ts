import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Run in a fresh process so other suites' Bun module mocks cannot replace the
// real workspace UI. Automatic JSX and esbuild's resolver also avoid the local
// workspace's broken dependency symlinks without modifying those dependencies.
const { outputFiles } = buildSync({
  stdin: {
    contents: `
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { LiveTvGuide } from "./live-tv-guide";
      export function render(props) {
        return renderToStaticMarkup(createElement(LiveTvGuide, {
          group: "",
          groups: [],
          onGroupChange: () => {},
          ...props,
          onChannelSelect: () => {},
        }));
      }
    `,
    resolveDir: fileURLToPath(new URL(".", import.meta.url)),
    loader: "jsx",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  external: ["react", "react-dom", "react-dom/*"],
  write: false,
});

const compiled = { exports: {} as { render: (props: unknown) => string } };
new Function("require", "module", "exports", outputFiles[0].text)(
  createRequire(import.meta.url),
  compiled,
  compiled.exports,
);
process.stdout.write(
  compiled.exports.render(JSON.parse(readFileSync(0, "utf8"))),
);
