# @steno/plugin-search

Search plugin for [Steno](https://github.com/stenopress/steno) that generates a
client-side search index by scanning the final rendered HTML of every page
in your build.

## Installation

```yaml
# content/.steno/config.yml
plugins:
  - jsr:@steno/plugin-search
```

## Options

```yaml
plugins:
  - package: jsr:@steno/plugin-search
    options:
      indexPath: search-index.json
      excerptLength: 180
      exclude:
        - /404
        - /drafts
```

| Option          | Type       | Default               | Description                                                                             |
| --------------- | ---------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| `indexPath`     | `string`   | `search-index.json`   | Output-relative path for the generated index file.                                       |
| `excerptLength` | `number`   | `180`                  | Maximum length, in characters, of each entry's excerpt.                                   |
| `exclude`       | `string[]` | `[]`                   | Route prefixes to omit from the index (exact string prefix match against the page route). |

## Usage

Once installed, the plugin automatically generates the search index directly
in your configured output directory on every build:

```text
dist/
├── index.html
├── posts/
│   └── hello-world.html
└── search-index.json    <-- Generated Automatically
```

## Index shape

The generated file is a JSON array, sorted by `title`, with one entry per
indexed page:

```json
[
  {
    "title": "Hello World",
    "route": "/posts/hello-world",
    "excerpt": "This is the opening text of the page, stripped of markup and truncated to the configured excerpt length...",
    "headings": ["Getting started", "Next steps"]
  }
]
```

- `title` is the content of the page's `<title>` tag, or an empty string if
  none is present.
- `route` is the page's public route, derived from its output path
  (`index.html` -> `/`, `foo/index.html` -> `/foo/`, `foo.html` -> `/foo`).
- `excerpt` is the page's rendered body with `<script>`/`<style>` blocks and
  all remaining HTML tags stripped, whitespace collapsed, and truncated to
  `excerptLength` characters.
- `headings` lists the text content of every `<h2>` and `<h3>` on the page,
  in document order.

## How it works

The plugin hooks into Steno's `beforeBuild`, `afterPage`, and `afterBuild`
lifecycle:

1. In `beforeBuild`, it captures the build's output directory so page paths
   can be resolved to public routes.
2. In `afterPage`, it inspects each rendered page's HTML directly — no
   re-parsing of Markdown or other content sources — extracting a title,
   headings, and excerpt, and computing its route. Pages matching an
   `exclude` prefix are skipped.
3. In `afterBuild`, it sorts the accumulated entries by title and writes the
   JSON index to `indexPath` in the output directory.

Because it works from rendered HTML rather than a specific content source,
this plugin indexes any Steno site regardless of how pages are authored.

Actually using this index client-side — wiring up a search-as-you-type box,
fuzzy matching, keyboard navigation, and so on — is left to your theme or
site. This plugin's job ends at producing the data file; how you fetch and
render it in the browser is up to you.

## License

MIT
