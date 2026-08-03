import { assert, assertEquals } from "@std/assert";
import searchPlugin from "./mod.ts";

function mockWriteTextFile() {
  const writtenFiles: Record<string, string> = {};
  const originalWriteTextFile = Deno.writeTextFile;

  Deno.writeTextFile = (
    path: string | URL,
    data: string | ReadableStream<string>,
  ): Promise<void> => {
    writtenFiles[String(path)] = typeof data === "string" ? data : "[Stream]";
    return Promise.resolve();
  };

  return {
    writtenFiles,
    restore: () => {
      Deno.writeTextFile = originalWriteTextFile;
    },
  };
}

Deno.test({
  name: "search: indexes a simple page with a title and heading",
  fn: async () => {
    const plugin = searchPlugin();
    const mockConfig = { output: "dist" } as Parameters<
      NonNullable<typeof plugin.beforeBuild>
    >[0];

    plugin.beforeBuild!(mockConfig);
    plugin.afterPage!({
      path: "dist/index.html",
      finalPath: "dist/index.html",
      html: "<html><head><title>Home</title></head><body>" +
        "<h2>Welcome</h2><p>Hello world.</p></body></html>",
    });

    const { writtenFiles, restore } = mockWriteTextFile();
    try {
      await plugin.afterBuild!(mockConfig);
    } finally {
      restore();
    }

    const index = JSON.parse(writtenFiles["dist/search-index.json"]);
    assertEquals(index.length, 1);
    assertEquals(index[0].title, "Home");
    assertEquals(index[0].route, "/");
    assertEquals(index[0].headings, ["Welcome"]);
  },
});

Deno.test({
  name: "search: derives routes for nested index and flat html pages",
  fn: async () => {
    const plugin = searchPlugin();
    const mockConfig = { output: "dist" } as Parameters<
      NonNullable<typeof plugin.beforeBuild>
    >[0];

    plugin.beforeBuild!(mockConfig);
    plugin.afterPage!({
      path: "dist/foo/index.html",
      finalPath: "dist/foo/index.html",
      html: "<title>Foo Index</title>",
    });
    plugin.afterPage!({
      path: "dist/foo.html",
      finalPath: "dist/foo.html",
      html: "<title>Foo</title>",
    });

    const { writtenFiles, restore } = mockWriteTextFile();
    try {
      await plugin.afterBuild!(mockConfig);
    } finally {
      restore();
    }

    const index = JSON.parse(writtenFiles["dist/search-index.json"]);
    const routes = index.map((entry: { route: string }) => entry.route);
    assert(routes.includes("/foo/"));
    assert(routes.includes("/foo"));
  },
});

Deno.test({
  name: "search: truncates excerpt and excludes script/style content",
  fn: async () => {
    const plugin = searchPlugin({ excerptLength: 20 });
    const mockConfig = { output: "dist" } as Parameters<
      NonNullable<typeof plugin.beforeBuild>
    >[0];

    plugin.beforeBuild!(mockConfig);
    plugin.afterPage!({
      path: "dist/index.html",
      finalPath: "dist/index.html",
      html: "<title>Page</title>" +
        "<script>var secretScriptContent = 1;</script>" +
        "<style>.secretStyleContent { color: red; }</style>" +
        "<p>This is the visible body content that goes well past twenty characters.</p>",
    });

    const { writtenFiles, restore } = mockWriteTextFile();
    try {
      await plugin.afterBuild!(mockConfig);
    } finally {
      restore();
    }

    const index = JSON.parse(writtenFiles["dist/search-index.json"]);
    assertEquals(index[0].excerpt.length, 20);
    assert(!index[0].excerpt.includes("secretScriptContent"));
    assert(!index[0].excerpt.includes("secretStyleContent"));
  },
});

Deno.test({
  name: "search: excludes pages matching an exclude prefix",
  fn: async () => {
    const plugin = searchPlugin({ exclude: ["/drafts"] });
    const mockConfig = { output: "dist" } as Parameters<
      NonNullable<typeof plugin.beforeBuild>
    >[0];

    plugin.beforeBuild!(mockConfig);
    plugin.afterPage!({
      path: "dist/drafts/secret.html",
      finalPath: "dist/drafts/secret.html",
      html: "<title>Secret Draft</title>",
    });
    plugin.afterPage!({
      path: "dist/public.html",
      finalPath: "dist/public.html",
      html: "<title>Public</title>",
    });

    const { writtenFiles, restore } = mockWriteTextFile();
    try {
      await plugin.afterBuild!(mockConfig);
    } finally {
      restore();
    }

    const index = JSON.parse(writtenFiles["dist/search-index.json"]);
    assertEquals(index.length, 1);
    assertEquals(index[0].title, "Public");
  },
});

Deno.test({
  name: "search: sorts entries by title in the written index",
  fn: async () => {
    const plugin = searchPlugin();
    const mockConfig = { output: "dist" } as Parameters<
      NonNullable<typeof plugin.beforeBuild>
    >[0];

    plugin.beforeBuild!(mockConfig);
    plugin.afterPage!({
      path: "dist/zebra.html",
      finalPath: "dist/zebra.html",
      html: "<title>Zebra</title>",
    });
    plugin.afterPage!({
      path: "dist/apple.html",
      finalPath: "dist/apple.html",
      html: "<title>Apple</title>",
    });
    plugin.afterPage!({
      path: "dist/mango.html",
      finalPath: "dist/mango.html",
      html: "<title>Mango</title>",
    });

    const { writtenFiles, restore } = mockWriteTextFile();
    try {
      await plugin.afterBuild!(mockConfig);
    } finally {
      restore();
    }

    const index = JSON.parse(writtenFiles["dist/search-index.json"]);
    const titles = index.map((entry: { title: string }) => entry.title);
    assertEquals(titles, ["Apple", "Mango", "Zebra"]);
  },
});

Deno.test({
  name: "search: ignores non-html pages",
  fn: async () => {
    const plugin = searchPlugin();
    const mockConfig = { output: "dist" } as Parameters<
      NonNullable<typeof plugin.beforeBuild>
    >[0];

    plugin.beforeBuild!(mockConfig);
    plugin.afterPage!({
      path: "dist/data.json",
      finalPath: "dist/data.json",
      html: "{}",
    });

    const { writtenFiles, restore } = mockWriteTextFile();
    try {
      await plugin.afterBuild!(mockConfig);
    } finally {
      restore();
    }

    const index = JSON.parse(writtenFiles["dist/search-index.json"]);
    assertEquals(index.length, 0);
  },
});
