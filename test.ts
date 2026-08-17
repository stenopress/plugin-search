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
  name:
    "search: derives route from the staging path, not finalPath, when they diverge",
  fn: async () => {
    // During a real build, beforeBuild's config.output is the staging
    // directory; page.finalPath is the eventual *published* path under a
    // different root entirely. Routes must be computed relative to the
    // staging root (page.path), matching what beforeBuild captured.
    const plugin = searchPlugin();
    const mockConfig = { output: ".steno-staging-abc" } as Parameters<
      NonNullable<typeof plugin.beforeBuild>
    >[0];

    plugin.beforeBuild!(mockConfig);
    plugin.afterPage!({
      path: ".steno-staging-abc/docs/foo/index.html",
      finalPath: "dist/docs/foo/index.html",
      html: "<title>Foo</title>",
    });

    const { writtenFiles, restore } = mockWriteTextFile();
    try {
      await plugin.afterBuild!(mockConfig);
    } finally {
      restore();
    }

    const index = JSON.parse(
      writtenFiles[".steno-staging-abc/search-index.json"],
    );
    assertEquals(index[0].route, "/docs/foo/");
  },
});

Deno.test({
  name: "search: only indexes pages matching an include prefix",
  fn: async () => {
    const plugin = searchPlugin({ include: ["/docs/"] });
    const mockConfig = { output: "dist" } as Parameters<
      NonNullable<typeof plugin.beforeBuild>
    >[0];

    plugin.beforeBuild!(mockConfig);
    plugin.afterPage!({
      path: "dist/docs/foo/index.html",
      finalPath: "dist/docs/foo/index.html",
      html: "<title>Docs Foo</title>",
    });
    plugin.afterPage!({
      path: "dist/blog/post.html",
      finalPath: "dist/blog/post.html",
      html: "<title>Blog Post</title>",
    });

    const { writtenFiles, restore } = mockWriteTextFile();
    try {
      await plugin.afterBuild!(mockConfig);
    } finally {
      restore();
    }

    const index = JSON.parse(writtenFiles["dist/search-index.json"]);
    assertEquals(index.length, 1);
    assertEquals(index[0].title, "Docs Foo");
  },
});

Deno.test({
  name: "search: exclude prefix is applied on top of include",
  fn: async () => {
    const plugin = searchPlugin({
      include: ["/docs/"],
      exclude: ["/docs/drafts"],
    });
    const mockConfig = { output: "dist" } as Parameters<
      NonNullable<typeof plugin.beforeBuild>
    >[0];

    plugin.beforeBuild!(mockConfig);
    plugin.afterPage!({
      path: "dist/docs/drafts/secret.html",
      finalPath: "dist/docs/drafts/secret.html",
      html: "<title>Secret</title>",
    });
    plugin.afterPage!({
      path: "dist/docs/foo.html",
      finalPath: "dist/docs/foo.html",
      html: "<title>Foo</title>",
    });

    const { writtenFiles, restore } = mockWriteTextFile();
    try {
      await plugin.afterBuild!(mockConfig);
    } finally {
      restore();
    }

    const index = JSON.parse(writtenFiles["dist/search-index.json"]);
    assertEquals(index.length, 1);
    assertEquals(index[0].title, "Foo");
  },
});

Deno.test({
  name: "search: scopes excerpt and headings to the contentSelector tag",
  fn: async () => {
    const plugin = searchPlugin();
    const mockConfig = { output: "dist" } as Parameters<
      NonNullable<typeof plugin.beforeBuild>
    >[0];

    plugin.beforeBuild!(mockConfig);
    plugin.afterPage!({
      path: "dist/index.html",
      finalPath: "dist/index.html",
      html: "<title>Page</title><body>" +
        "<nav><h2>Nav Heading</h2>Nav junk text</nav>" +
        "<main><h2>Real Heading</h2><p>Real body text.</p></main>" +
        "</body>",
    });

    const { writtenFiles, restore } = mockWriteTextFile();
    try {
      await plugin.afterBuild!(mockConfig);
    } finally {
      restore();
    }

    const index = JSON.parse(writtenFiles["dist/search-index.json"]);
    assertEquals(index[0].headings, ["Real Heading"]);
    assert(!index[0].excerpt.includes("Nav junk text"));
    assert(index[0].excerpt.includes("Real body text."));
  },
});

Deno.test({
  name: "search: falls back to full page when contentSelector tag is missing",
  fn: async () => {
    const plugin = searchPlugin();
    const mockConfig = { output: "dist" } as Parameters<
      NonNullable<typeof plugin.beforeBuild>
    >[0];

    plugin.beforeBuild!(mockConfig);
    plugin.afterPage!({
      path: "dist/index.html",
      finalPath: "dist/index.html",
      html: "<title>Page</title><body><h2>Only Heading</h2>Body text.</body>",
    });

    const { writtenFiles, restore } = mockWriteTextFile();
    try {
      await plugin.afterBuild!(mockConfig);
    } finally {
      restore();
    }

    const index = JSON.parse(writtenFiles["dist/search-index.json"]);
    assertEquals(index[0].headings, ["Only Heading"]);
    assert(index[0].excerpt.includes("Body text."));
  },
});

Deno.test({
  name: "search: writes the index to a custom indexPath",
  fn: async () => {
    const plugin = searchPlugin({ indexPath: "assets/idx.json" });
    const mockConfig = { output: "dist" } as Parameters<
      NonNullable<typeof plugin.beforeBuild>
    >[0];

    plugin.beforeBuild!(mockConfig);
    plugin.afterPage!({
      path: "dist/index.html",
      finalPath: "dist/index.html",
      html: "<title>Home</title>",
    });

    const { writtenFiles, restore } = mockWriteTextFile();
    try {
      await plugin.afterBuild!(mockConfig);
    } finally {
      restore();
    }

    assert("dist/assets/idx.json" in writtenFiles);
    assert(!("dist/search-index.json" in writtenFiles));
  },
});

Deno.test({
  name: "search: defaults to an empty title when no <title> tag is present",
  fn: async () => {
    const plugin = searchPlugin();
    const mockConfig = { output: "dist" } as Parameters<
      NonNullable<typeof plugin.beforeBuild>
    >[0];

    plugin.beforeBuild!(mockConfig);
    plugin.afterPage!({
      path: "dist/index.html",
      finalPath: "dist/index.html",
      html: "<body><p>No title here.</p></body>",
    });

    const { writtenFiles, restore } = mockWriteTextFile();
    try {
      await plugin.afterBuild!(mockConfig);
    } finally {
      restore();
    }

    const index = JSON.parse(writtenFiles["dist/search-index.json"]);
    assertEquals(index[0].title, "");
  },
});

Deno.test({
  name: "search: writes an empty array when no pages are indexed",
  fn: async () => {
    const plugin = searchPlugin();
    const mockConfig = { output: "dist" } as Parameters<
      NonNullable<typeof plugin.beforeBuild>
    >[0];

    plugin.beforeBuild!(mockConfig);

    const { writtenFiles, restore } = mockWriteTextFile();
    try {
      await plugin.afterBuild!(mockConfig);
    } finally {
      restore();
    }

    const index = JSON.parse(writtenFiles["dist/search-index.json"]);
    assertEquals(index, []);
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
