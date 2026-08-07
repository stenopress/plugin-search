/**
 * Steno plugin for generating a client-side search index from rendered HTML.
 */
import type { GeneratedPage, SiteConfig, StenoPlugin } from "steno";
import { basename, dirname, join, relative } from "@std/path";

/** Options for the generated search index. */
export interface SearchPluginOptions {
  /** Output-relative path for the generated index. Default "search-index.json". */
  indexPath?: string;
  /** Max excerpt length in characters. Default 180. */
  excerptLength?: number;
  /**
   * Route prefixes to exclude from the index (exact string prefix match
   * against the derived route, e.g. "/404").
   */
  exclude?: string[];
  /**
   * Route prefixes to include in the index (exact string prefix match
   * against the derived route, e.g. "/docs/"). When set, only routes
   * matching one of these prefixes are indexed; `exclude` is still applied
   * on top of this.
   */
  include?: string[];
  /**
   * CSS-tag-like selector for the element whose contents are indexed
   * (excerpt + headings). Only bare tag names are supported (e.g. "main",
   * "article"). Default "main". Falls back to the full document if no
   * matching tag is found on a page.
   */
  contentSelector?: string;
}

/** A single entry in the generated search index. */
export interface SearchIndexEntry {
  /** Page title, extracted from the rendered `<title>` tag. */
  title: string;
  /** Public route for the page. */
  route: string;
  /** Truncated, tag-stripped excerpt of the page body. */
  excerpt: string;
  /** Text content of every `<h2>`/`<h3>` heading on the page, in document order. */
  headings: string[];
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  return stripTags(match[1]).replace(/\s+/g, " ").trim();
}

function extractHeadings(html: string): string[] {
  const headings: string[] = [];
  const regex = /<(h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(regex)) {
    const text = stripTags(match[2]).replace(/\s+/g, " ").trim();
    if (text) headings.push(text);
  }
  return headings;
}

/**
 * Narrows `html` down to the contents of the first element matching the
 * given bare tag name (e.g. "main"). Returns the full `html` unchanged if
 * no matching tag is found.
 */
function extractContentRegion(html: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = html.match(regex);
  return match ? match[1] : html;
}

function extractExcerpt(html: string, excerptLength: number): string {
  const withoutScriptsAndStyles = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
  const plain = stripTags(withoutScriptsAndStyles)
    .replace(/\s+/g, " ")
    .trim();
  return plain.slice(0, excerptLength);
}

/**
 * Derives a public route from a page's output-relative path.
 *
 * `index.html` -> `/`; `foo/index.html` -> `/foo/`; `foo.html` -> `/foo`
 * (no trailing slash, matching `shortUrls: false` output).
 */
function routeFromPath(relPath: string): string {
  const normalized = relPath.replaceAll("\\", "/");
  const dir = dirname(normalized);
  const base = basename(normalized);
  const dirPrefix = dir === "." || dir === "" ? "" : `/${dir}`;

  if (base === "index.html") {
    return dirPrefix === "" ? "/" : `${dirPrefix}/`;
  }

  const name = base.replace(/\.html$/, "");
  return `${dirPrefix}/${name}`;
}

/** Creates a Steno plugin that generates a client-side search index. */
export default function searchPlugin(
  options: SearchPluginOptions = {},
): StenoPlugin {
  const indexPath = options.indexPath ?? "search-index.json";
  const excerptLength = options.excerptLength ?? 180;
  const exclude = options.exclude ?? [];
  const include = options.include ?? [];
  const contentSelector = options.contentSelector ?? "main";

  let outputDir = "dist";
  const entries: SearchIndexEntry[] = [];

  return {
    name: "steno-plugin-search",

    beforeBuild(config: SiteConfig): void {
      outputDir = config.output ?? "dist";
    },

    afterPage(page: GeneratedPage): void {
      // `page.path` is the staging file, which `outputDir` (captured from
      // `beforeBuild`'s already-staged `config.output`) is relative to.
      // `page.finalPath` is the eventual *published* path and lives under a
      // different root entirely - computing `relative(outputDir, finalPath)`
      // would produce a garbage route like "/../dist/docs/foo/".
      if (!page.path.endsWith(".html")) return;

      const relPath = relative(outputDir, page.path);
      const route = routeFromPath(relPath);

      if (
        include.length > 0 &&
        !include.some((prefix) => route.startsWith(prefix))
      ) {
        return;
      }
      if (exclude.some((prefix) => route.startsWith(prefix))) return;

      const region = extractContentRegion(page.html, contentSelector);

      entries.push({
        title: extractTitle(page.html),
        route,
        excerpt: extractExcerpt(region, excerptLength),
        headings: extractHeadings(region),
      });
    },

    async afterBuild(config: SiteConfig): Promise<void> {
      const dir = config.output ?? outputDir;
      const sorted = [...entries].sort((a, b) =>
        a.title.localeCompare(b.title)
      );
      await Deno.writeTextFile(join(dir, indexPath), JSON.stringify(sorted));
    },
  };
}
