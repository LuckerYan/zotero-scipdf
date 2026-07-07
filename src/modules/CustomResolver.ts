// https://www.zotero.org/support/kb/custom_pdf_resolvers
// https://github.com/zotero/zotero/blob/5536f8d2bd08ddac9074b9df05b7d205273835e7/chrome/content/zotero/xpcom/attachments.js#L1350
export interface CustomResolver {
  name: string;
  method: "GET" | "POST";
  url: string; // must include {doi}
  mode: "html" | "json";
  selector: string;
  automatic?: boolean;

  // HTML
  attribute?: string;
  index?: number;

  // JSON
  mappings?: {
    url?: string;
    pageURL?: string;
  };
}

export function isCustomResolverEqual(a: CustomResolver, b: CustomResolver) {
  // Zotero treats `automatic` as a resolver option, not as part of the resolver identity.
  // Comparing without it lets preference changes update an existing Sci-Hub resolver instead
  // of creating a second resolver for the same URL in Zotero 9+'s file-resolver pipeline.
  return (
    a.name === b.name &&
    a.method === b.method &&
    a.url === b.url &&
    a.mode === b.mode &&
    a.selector === b.selector &&
    a.attribute === b.attribute &&
    a.index === b.index &&
    a.mappings?.url === b.mappings?.url &&
    a.mappings?.pageURL === b.mappings?.pageURL
  );
}

export function sciHubCustomResolver(
  url: string,
  automatic = true,
): CustomResolver {
  return sciHubCustomResolvers(url, automatic)[0];
}

export function sciHubCustomResolvers(
  url: string,
  automatic = true,
): CustomResolver[] {
  const resolverURL = url.includes("{doi}")
    ? url
    : url.endsWith("/")
      ? `${url}{doi}`
      : `${url}/{doi}`;
  const common = {
    name: "Sci-Hub",
    method: "GET" as const,
    url: resolverURL,
    mode: "html" as const,
    automatic: automatic,
  };
  return [
    {
      ...common,
      selector: "object[type='application/pdf']",
      attribute: "data",
    },
    {
      ...common,
      selector: 'meta[name="citation_pdf_url"]',
      attribute: "content",
    },
    {
      ...common,
      selector: "#pdf",
      attribute: "src",
    },
    {
      ...common,
      selector: "iframe[src*='.pdf']",
      attribute: "src",
    },
    {
      ...common,
      selector: "embed[src*='.pdf']",
      attribute: "src",
    },
    {
      ...common,
      selector: "a[href*='.pdf']",
      attribute: "href",
    },
  ];
}

export function presetSciHubCustomResolvers(
  automatic = true,
): Readonly<Readonly<CustomResolver>[]> {
  const scihubURLs = [
    "https://sci-hub.kvnp.top/",
    "https://www.tesble.com/",
    "https://sci-hub.ru/",
    "https://sci-hub.su/",
    "https://sci-hub.red/",
    "https://sci-hub.box/",
    "https://sci-hub.st/",
    "https://sci-hub.ren/",
    "https://sci-hub.world/",
  ];
  return scihubURLs.flatMap((url) => sciHubCustomResolvers(url, automatic));
}
