#!/usr/bin/env node
/**
 * Generates `src/core/shapes/brand-data.ts`: a curated set of technology brand
 * logos from `simple-icons` (CC0 data; the marks themselves are trademarks of
 * their owners) as 24×24 filled SVG paths, for the `brands` shape library.
 *
 * Run: `npm run icons:brands` after editing the list below.
 *
 * Entry format: `slug` or `slug|alias, alias…` (the slug is the simple-icons
 * slug and becomes the shape id `brands/<slug>`). Slugs missing from the
 * installed simple-icons version are skipped with a warning, except the ones
 * in FALLBACKS, which get a generic glyph in the vendor colour instead.
 */
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as simpleIcons from "simple-icons";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "core", "shapes", "brand-data.ts");

/** Palette order. */
const GROUPS = [
  [
    "Cloud & hosting",
    [
      "amazonaws|aws, amazon web services, amazon-web-services, amazon aws",
      "microsoftazure|azure, microsoft azure",
      "googlecloud|gcp, google cloud platform, google-cloud",
      "cloudflare",
      "cloudflareworkers|workers, cloudflare workers",
      "cloudflarepages|pages, cloudflare pages",
      "vercel",
      "netlify",
      "digitalocean|digital ocean",
      "heroku",
      "ibmcloud|ibm cloud, ibm",
      "oracle|oracle cloud, oci",
      "alibabacloud|aliyun, alibaba cloud",
      "akamai",
      "fastly",
      "openstack",
      "vmware",
      "redhat|red hat",
      "scaleway",
      "hetzner",
      "render",
      "railway",
      "flydotio|fly, fly.io",
      "supabase",
      "firebase",
      "appwrite",
      "googlecloudstorage|gcs, google cloud storage, cloud storage",
      "googlebigquery|bigquery, big query",
      "googlepubsub|pubsub, pub/sub, google pubsub",
      "googlecloudspanner|spanner, cloud spanner",
      "googlebigtable|bigtable",
      "googlecloudcomposer|composer, cloud composer",
      "googledataflow|dataflow",
      "googledataproc|dataproc",
    ],
  ],
  [
    "Infrastructure & DevOps",
    [
      "docker",
      "kubernetes|k8s, kube",
      "terraform",
      "ansible",
      "helm",
      "nginx",
      "apache|apache http server, httpd",
      "traefikproxy|traefik",
      "envoyproxy|envoy",
      "istio",
      "consul",
      "vault|hashicorp vault",
      "packer",
      "vagrant",
      "pulumi",
      "puppet",
      "chef",
      "redhatopenshift|openshift",
      "rancher",
      "podman",
      "containerd",
      "argo|argo cd, argocd, argo workflows",
      "flux|fluxcd",
      "tailscale",
      "wireguard",
      "openvpn",
      "letsencrypt|lets encrypt, letsencrypt",
    ],
  ],
  [
    "Data & storage",
    [
      "postgresql|postgres, pg, psql",
      "mysql",
      "mariadb",
      "mongodb|mongo",
      "redis",
      "sqlite",
      "elasticsearch|elastic search",
      "apachecassandra|cassandra",
      "neo4j",
      "snowflake",
      "clickhouse",
      "influxdb",
      "couchbase",
      "cockroachlabs|cockroachdb, cockroach",
      "timescale|timescaledb",
      "planetscale",
      "prisma",
      "duckdb",
      "databricks",
      "apachespark|spark",
      "apachehadoop|hadoop",
      "apacheairflow|airflow",
      "opensearch",
      "meilisearch",
      "apachehive|hive",
      "apachesolr|solr",
    ],
  ],
  [
    "Messaging & streaming",
    ["apachekafka|kafka", "rabbitmq", "natsdotio|nats", "apachepulsar|pulsar", "apacheflink|flink", "mqtt"],
  ],
  [
    "Observability",
    [
      "grafana",
      "prometheus",
      "datadog",
      "opentelemetry|otel",
      "sentry",
      "newrelic|new relic",
      "kibana",
      "logstash",
      "splunk",
      "jaeger",
      "fluentd",
      "pagerduty",
      "elastic|elastic stack, elk",
      "dynatrace",
      "opsgenie",
      "uptimekuma|uptime kuma",
    ],
  ],
  [
    "Dev tools & CI",
    [
      "git",
      "github",
      "gitlab",
      "bitbucket",
      "jenkins",
      "githubactions|github actions",
      "circleci",
      "travisci|travis",
      "teamcity",
      "gitea",
      "drone",
      "gitkraken",
      "githubcopilot|copilot, github copilot",
      "npm",
      "yarn",
      "pnpm",
      "postman",
      "swagger|openapi",
    ],
  ],
  [
    "Languages & frameworks",
    [
      "python",
      "nodedotjs|node, nodejs, node.js",
      "typescript|ts",
      "javascript|js",
      "go|golang",
      "rust",
      "kotlin",
      "swift",
      "react|reactjs",
      "nextdotjs|nextjs, next.js, next",
      "vuedotjs|vue, vuejs",
      "angular",
      "svelte",
      "django",
      "flask",
      "fastapi",
      "spring",
      "springboot|spring boot",
      "dotnet|.net, dotnet core",
      "php",
      "ruby",
      "rubyonrails|rails, ruby on rails",
      "laravel",
      "openjdk|java, jdk",
      "cplusplus|c++, cpp",
      "c",
      "scala",
      "elixir",
      "erlang",
      "haskell",
      "dart",
      "flutter",
      "nuxt|nuxtjs",
      "express|expressjs",
      "nestjs|nest",
      "graphql",
      "deno",
      "bun",
      "vite",
      "webpack",
      "tailwindcss|tailwind",
      "html5|html",
      "css",
      "numpy",
      "pandas",
      "lua",
      "perl",
      "r",
      "julia",
      "solidity",
    ],
  ],
  [
    "AI & machine learning",
    [
      "openai|chatgpt, gpt",
      "anthropic",
      "claude",
      "huggingface|hugging face, hf",
      "pytorch",
      "tensorflow",
      "langchain",
      "ollama",
      "mistralai|mistral",
      "googlegemini|gemini",
      "jupyter",
      "scikitlearn|scikit-learn, sklearn",
      "keras",
      "nvidia",
      "perplexity",
      "deepseek",
    ],
  ],
  [
    "SaaS & tools",
    [
      "stripe",
      "slack",
      "notion",
      "jira",
      "confluence",
      "atlassian",
      "trello",
      "asana",
      "linear",
      "figma",
      "miro",
      "airtable",
      "zapier",
      "intercom",
      "mixpanel",
      "hubspot",
      "mailchimp",
      "shopify",
      "paypal",
      "twilio",
      "salesforce",
      "auth0",
      "okta",
      "keycloak",
      "discord",
      "telegram",
      "whatsapp",
      "zoom",
      "sap",
    ],
  ],
  [
    "Operating systems & devices",
    [
      "linux",
      "ubuntu",
      "debian",
      "centos",
      "fedora",
      "alpinelinux|alpine",
      "archlinux|arch",
      "freebsd",
      "apple",
      "macos",
      "ios",
      "android",
      "windows",
      "raspberrypi|raspberry pi",
      "googlechrome|chrome",
      "firefox",
      "safari",
    ],
  ],
];

/**
 * Brands that simple-icons has removed at its owners' request but diagrams
 * cannot do without: a generic cloud glyph in the vendor's colour, labelled
 * with the name. The official artwork comes from the vendor's icon pack
 * (see docs/icons.md); the id and aliases stay the same.
 */
const FALLBACKS = {
  amazonaws: { title: "AWS", hex: "FF9900", icon: "cloud" },
  microsoftazure: { title: "Azure", hex: "0078D4", icon: "cloud" },
};

const available = new Map();
for (const value of Object.values(simpleIcons)) {
  if (value && typeof value === "object" && typeof value.slug === "string" && typeof value.path === "string") available.set(value.slug, value);
}
const version = JSON.parse(readFileSync(path.join(ROOT, "node_modules", "simple-icons", "package.json"), "utf8")).version;

const entries = [];
const missing = [];
const seen = new Set();
for (const [group, list] of GROUPS) {
  for (const item of list) {
    const [slug, aliasList = ""] = item.split("|");
    if (seen.has(slug)) throw new Error(`Duplicate slug in the brand list: ${slug}`);
    seen.add(slug);
    const aliases = aliasList
      .split(",")
      .map((alias) => alias.trim())
      .filter(Boolean);
    const icon = available.get(slug);
    if (icon) {
      entries.push({ slug, group, aliases, title: icon.title, hex: icon.hex, path: icon.path });
    } else if (FALLBACKS[slug]) {
      entries.push({ slug, group, aliases, ...FALLBACKS[slug] });
      missing.push(`${slug} (generic glyph)`);
    } else {
      missing.push(slug);
    }
  }
}

const lines = entries.map((entry) => {
  const fields = [
    `title: ${JSON.stringify(entry.title)}`,
    `hex: ${JSON.stringify(`#${entry.hex.toLowerCase()}`)}`,
    `group: ${JSON.stringify(entry.group)}`,
  ];
  if (entry.aliases.length) fields.push(`aliases: ${JSON.stringify(entry.aliases)}`);
  if (entry.path) fields.push(`path: ${JSON.stringify(entry.path)}`);
  if (entry.icon) fields.push(`icon: ${JSON.stringify(entry.icon)}`);
  return `  ${JSON.stringify(entry.slug)}: { ${fields.join(", ")} },`;
});

const source = `// GENERATED by scripts/gen-brand-icons.mjs — do not edit by hand.
// Logo geometry from simple-icons ${version} (CC0). The marks are trademarks of their owners;
// they are included for identification in architecture diagrams only. See docs/icons.md.

export interface BrandData {
  title: string;
  /** Brand colour, \`#rrggbb\`. */
  hex: string;
  /** Palette grouping, in display order. */
  group: string;
  /** Names people and agents use besides the slug and title. */
  aliases?: string[];
  /** Filled glyph on a 24×24 grid. */
  path?: string;
  /** Stroke icon from \`icon-data.ts\`, for brands missing from simple-icons. */
  icon?: string;
}

export const BRAND_DATA: Record<string, BrandData> = {
${lines.join("\n")}
};
`;

await writeFile(OUT, source);
console.log(`✓ ${entries.length} brands → ${path.relative(process.cwd(), OUT)} (${(source.length / 1024).toFixed(0)} kB, simple-icons ${version})`);
if (missing.length) console.warn(`! not in simple-icons ${version}: ${missing.join(", ")}`);
