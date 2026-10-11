import { iconTile, type IconPreset } from "../icon-shapes";
import { body, icon, mix, PALETTE, rectPath, type ShapeDef, type ShapeLibrary } from "../kit";

type Swatch = NonNullable<IconPreset["color"]>;

/* -------------------------------------------------------------- containers */

const ZONE_HEADER = 32;
const ZONE_ICON = 16;

export interface ZonePreset extends IconPreset {
  /** Default size. */
  size?: { w: number; h: number };
  /** Dashed border, for logical rather than physical boundaries. */
  dashed?: boolean;
  /** Fill: a light tint of the colour, or nothing at all. */
  fill?: "tint" | "none";
}

/**
 * Titled boundary container: small icon + title in the top-left header strip.
 * The icon is read from `data.icon`. Shared by the infra and AI libraries.
 */
export function zoneContainer(preset: ZonePreset): ShapeDef {
  const swatch = PALETTE[preset.color ?? "gray"];
  return {
    id: preset.id,
    name: preset.name,
    aliases: preset.aliases,
    keywords: preset.keywords,
    description: preset.description,
    text: preset.text ?? preset.name,
    data: { icon: preset.icon },
    size: preset.size ?? { w: 420, h: 280 },
    minSize: { w: 120, h: 80 },
    container: { header: ZONE_HEADER, padding: 20 },
    style: {
      fill: preset.fill === "none" ? "none" : mix(swatch.fill, "#ffffff", 0.55),
      stroke: swatch.stroke,
      strokeWidth: 1.25,
      dash: preset.dashed ? "dashed" : "solid",
      radius: 10,
      align: "left",
      valign: "top",
      bold: true,
      fontSize: 13,
      textColor: swatch.text,
    },
    label: (ctx) => {
      const x = Math.min(10 + ZONE_ICON + 6, ctx.w / 2);
      return { box: { x, y: 0, w: ctx.w - x, h: Math.min(ZONE_HEADER, ctx.h) }, padding: 0, valign: "middle", wrap: false };
    },
    draw: (ctx) => {
      const { w, h, style, data } = ctx;
      const size = Math.min(ZONE_ICON, w - 12, h - 12);
      const name = typeof data.icon === "string" ? data.icon : preset.icon;
      return [
        body(ctx, rectPath(0, 0, w, h, style.radius)),
        ...icon(ctx, name, Math.min(10, (w - size) / 2), (Math.min(ZONE_HEADER, h) - size) / 2, size),
      ];
    },
  };
}

const zones: ZonePreset[] = [
  {
    id: "infra/account",
    name: "Cloud account",
    icon: "cloud",
    color: "gray",
    fill: "none",
    size: { w: 640, h: 440 },
    aliases: ["cloud-account", "subscription", "aws-account", "gcp-project", "azure-subscription", "tenant", "landing-zone"],
    description: "Outermost boundary: a cloud account, subscription or project that owns the resources inside.",
  },
  {
    id: "infra/region",
    name: "Region",
    icon: "map-pin",
    color: "gray",
    dashed: true,
    fill: "none",
    size: { w: 560, h: 380 },
    aliases: ["cloud-region", "geo", "location", "datacenter", "data-center"],
    description: "Geographic region or data centre grouping the resources deployed there.",
    text: "Region",
  },
  {
    id: "infra/availability-zone",
    name: "Availability zone",
    icon: "layers-2",
    color: "blue",
    dashed: true,
    fill: "none",
    size: { w: 280, h: 300 },
    aliases: ["az", "zone-a", "fault-domain"],
    description: "Isolated zone inside a region; draw one per AZ to show redundancy.",
    text: "Availability zone",
  },
  {
    id: "infra/vpc",
    name: "VPC",
    icon: "network",
    color: "purple",
    size: { w: 500, h: 320 },
    aliases: ["virtual-network", "vnet", "virtual-private-cloud", "private-network"],
    description: "Virtual private network boundary containing subnets and the resources attached to them.",
    text: "VPC",
  },
  {
    id: "infra/subnet",
    name: "Subnet",
    icon: "lock",
    color: "teal",
    size: { w: 300, h: 220 },
    aliases: ["public-subnet", "private-subnet", "network-segment", "dmz", "vlan"],
    description: "Subnet inside a virtual network. Set data.icon to lock-open for a public subnet.",
    text: "Private subnet",
  },
  {
    id: "infra/security-group",
    name: "Security group",
    icon: "shield",
    color: "red",
    dashed: true,
    fill: "none",
    size: { w: 260, h: 180 },
    aliases: ["sg", "network-policy", "firewall-rules", "nsg", "trust-boundary"],
    description: "Dashed red boundary around resources that share the same network access rules.",
  },
  {
    id: "infra/cluster",
    name: "Cluster",
    icon: "boxes",
    color: "blue",
    size: { w: 440, h: 280 },
    aliases: ["kubernetes-cluster", "k8s-cluster", "ecs-cluster", "node-pool", "server-cluster", "auto-scaling-group"],
    description: "Group of nodes managed as one unit (Kubernetes cluster, node pool, auto-scaling group).",
  },
  {
    id: "infra/namespace",
    name: "Namespace",
    icon: "folder",
    color: "blue",
    dashed: true,
    fill: "none",
    size: { w: 320, h: 220 },
    aliases: ["k8s-namespace", "kubernetes-namespace", "env", "deployment-environment", "staging", "production", "resource-group", "tenant-namespace"],
    description: "Logical grouping inside a cluster or account (namespace, resource group, environment).",
  },
];

/* ------------------------------------------------------------------- tiles */

/** `[short id, name, icon, aliases, description]` */
type Row = [id: string, name: string, icon: string, aliases: string[], description: string];

const CATEGORIES: { color: Swatch; rows: Row[] }[] = [
  {
    // Compute
    color: "blue",
    rows: [
      ["server", "Server", "server", ["host", "machine", "bare-metal", "node-server", "ec2", "app-server", "backend"], "Physical or generic server / host."],
      ["vm", "Virtual machine", "cpu", ["virtual-machine", "instance", "compute-instance", "compute-engine", "droplet-vm"], "Virtual machine or cloud compute instance."],
      ["service", "Service", "hexagon", ["microservice", "app-service", "backend-service", "web-service", "application"], "A deployed application service or microservice."],
      ["container", "Container", "container", ["docker", "docker-container", "oci-container", "ecs-task", "fargate", "cloud-run"], "A running container (Docker, ECS task, Cloud Run)."],
      ["kubernetes", "Kubernetes", "boxes", ["k8s", "eks", "gke", "aks", "openshift", "orchestrator-k8s"], "Kubernetes cluster or control plane as a single node."],
      ["pod", "Pod", "box", ["k8s-pod", "kubernetes-pod", "deployment", "replica", "workload"], "Kubernetes pod / deployment replica."],
      ["function", "Function", "square-function", ["lambda", "serverless", "cloud-function", "azure-function", "faas", "edge-function", "serverless-function"], "Serverless function (Lambda, Cloud Functions)."],
      ["batch-job", "Batch job", "square-stack", ["job", "batch", "background-job", "k8s-job", "task-runner"], "Run-to-completion batch or background job."],
      ["scheduler", "Scheduler", "calendar-clock", ["cron", "cronjob", "cron-job", "scheduled-task", "eventbridge-scheduler", "timer-trigger"], "Cron / scheduler that starts work on a timetable."],
      ["worker", "Worker", "cog", ["background-worker", "consumer", "queue-worker", "daemon", "sidekiq", "celery"], "Long-running worker that consumes jobs or messages."],
    ],
  },
  {
    // Data
    color: "green",
    rows: [
      ["sql-database", "SQL database", "database", ["postgres", "postgresql", "mysql", "rds", "relational-db", "relational-database", "sql", "sql-db", "aurora", "mariadb", "sqlite", "cloud-sql"], "Relational database (Postgres, MySQL, RDS)."],
      ["nosql-database", "NoSQL database", "braces", ["nosql", "mongodb", "dynamodb", "document-db", "document-store", "cassandra", "key-value-store", "firestore", "cosmosdb"], "Document, key-value or wide-column database."],
      ["cache", "Cache", "database-zap", ["redis", "memcached", "in-memory-cache", "elasticache", "valkey", "key-value-cache"], "In-memory cache in front of slower stores."],
      ["object-storage", "Object storage", "archive", ["s3", "blob-storage", "bucket", "gcs", "object-store", "s3-bucket", "blob", "r2", "minio"], "Bucket / blob storage for files and artefacts."],
      ["file-storage", "File storage", "hard-drive", ["disk", "volume", "block-storage", "file-system", "nfs", "efs", "ebs", "persistent-volume", "file-share"], "Disk, volume or shared file system."],
      ["data-warehouse", "Data warehouse", "warehouse", ["warehouse", "snowflake", "bigquery", "redshift", "olap", "analytics-db", "clickhouse", "synapse"], "Analytical warehouse for reporting and BI."],
      ["data-lake", "Data lake", "droplet", ["lake", "lakehouse", "delta-lake", "raw-data", "databricks", "iceberg"], "Raw / semi-structured data lake or lakehouse."],
      ["search-index", "Search index", "text-search", ["elasticsearch", "opensearch", "search-engine", "full-text-search", "solr", "algolia", "index"], "Full-text search engine or index."],
      ["backup", "Backup", "database-backup", ["snapshot", "replica-backup", "disaster-recovery", "dr", "restore", "archive-backup"], "Backups, snapshots and disaster-recovery copies."],
    ],
  },
  {
    // Messaging and integration
    color: "orange",
    rows: [
      ["queue", "Queue", "inbox", ["sqs", "rabbitmq", "message-queue", "mq", "task-queue", "job-queue", "dead-letter-queue", "dlq", "service-bus-queue"], "Point-to-point message or task queue."],
      ["topic", "Topic", "megaphone", ["pub-sub", "pubsub", "sns", "publish-subscribe", "notification-topic", "fanout"], "Publish/subscribe topic that fans messages out to subscribers."],
      ["event-bus", "Event bus", "waypoints", ["eventbridge", "event-grid", "message-bus", "service-bus", "event-router", "nats", "message-broker", "broker"], "Event bus / broker routing events between services."],
      ["stream", "Stream", "activity", ["kafka", "kinesis", "event-stream", "data-stream", "event-hub", "pulsar", "redpanda", "log-stream"], "Ordered, replayable event stream (Kafka, Kinesis)."],
      ["api-gateway", "API gateway", "split", ["api-gw", "apigw", "kong", "apigee", "ingress", "ingress-controller", "bff", "edge-gateway"], "Single entry point that routes and secures API calls."],
      ["webhook", "Webhook", "webhook", ["callback", "http-callback", "outbound-webhook", "inbound-webhook"], "HTTP callback sent to or received from another system."],
      ["etl-pipeline", "ETL pipeline", "workflow", ["etl", "elt", "data-pipeline", "pipeline", "airflow", "dbt", "glue", "dataflow", "ingestion"], "Pipeline that extracts, transforms and loads data."],
      ["email", "Email service", "mail", ["smtp", "ses", "sendgrid", "mail-server", "email-service", "mailer", "notification-service"], "Outbound or inbound email delivery."],
    ],
  },
  {
    // Network
    color: "purple",
    rows: [
      ["load-balancer", "Load balancer", "network", ["lb", "alb", "nlb", "elb", "nginx", "haproxy", "traffic-manager", "reverse-proxy-lb"], "Distributes traffic across several instances."],
      ["cdn", "CDN", "earth", ["cloudfront", "content-delivery-network", "edge-cache", "edge-network", "fastly", "akamai", "edge"], "Content delivery network / edge cache."],
      ["dns", "DNS", "signpost", ["route53", "domain", "name-server", "nameserver", "dns-zone", "domain-name", "cloud-dns"], "DNS zone or resolver mapping names to addresses."],
      ["firewall", "Firewall", "flame", ["network-firewall", "fw", "packet-filter", "iptables", "nacl", "network-acl"], "Network firewall filtering traffic between zones."],
      ["vpn", "VPN", "lock", ["vpn-gateway", "vpn-tunnel", "site-to-site", "wireguard", "tunnel", "private-link", "direct-connect", "expressroute"], "Encrypted tunnel or private link between networks."],
      ["router", "Router", "router", ["network-router", "route-table", "transit-gateway", "peering", "wifi-router"], "Routes packets between networks."],
      ["switch", "Switch", "arrow-left-right", ["network-switch", "ethernet-switch", "l2-switch", "hub"], "Layer-2 switch connecting devices on one network."],
      ["nat-gateway", "NAT gateway", "shuffle", ["nat", "egress-gateway", "internet-gateway", "igw", "outbound-gateway"], "Gateway giving private resources outbound internet access."],
      ["internet", "Internet", "globe", ["www", "public-internet", "web", "world-wide-web", "public-network"], "The public internet."],
      ["proxy", "Proxy", "repeat", ["reverse-proxy", "forward-proxy", "envoy", "sidecar", "service-mesh", "istio", "traefik", "squid"], "Forward / reverse proxy or service-mesh sidecar."],
    ],
  },
  {
    // Security and identity
    color: "red",
    rows: [
      ["identity-provider", "Identity provider", "fingerprint", ["auth", "idp", "sso", "oauth", "oidc", "authentication", "iam", "auth0", "okta", "cognito", "keycloak", "login", "auth-service", "entra-id", "active-directory"], "Authentication / identity provider (SSO, OAuth, IAM)."],
      ["secrets-vault", "Secrets vault", "vault", ["vault", "secrets", "secrets-manager", "secret-store", "key-vault", "hashicorp-vault", "parameter-store"], "Secure store for secrets, tokens and credentials."],
      ["certificate", "Certificate", "badge-check", ["tls", "ssl", "cert", "tls-certificate", "ssl-certificate", "acm", "certificate-authority", "ca", "lets-encrypt", "mtls"], "TLS certificate or certificate authority."],
      ["waf", "WAF", "shield-alert", ["web-application-firewall", "ddos-protection", "bot-protection", "rate-limiter", "shield"], "Web application firewall / DDoS and bot protection."],
      ["key-management", "Key management", "key-round", ["kms", "encryption-keys", "hsm", "key-store", "encryption", "cmk"], "Encryption key management service or HSM."],
    ],
  },
  {
    // Clients and devices
    color: "gray",
    rows: [
      ["browser", "Browser", "app-window", ["web-client", "webapp", "spa", "frontend", "web-browser", "website", "web-ui"], "Web client running in a browser."],
      ["mobile-app", "Mobile app", "smartphone", ["mobile", "phone-app", "ios", "android", "ios-app", "android-app", "mobile-client"], "Native or hybrid mobile application."],
      ["desktop-app", "Desktop app", "monitor", ["desktop", "desktop-client", "workstation", "pc", "electron-app", "native-app"], "Desktop application or workstation."],
      ["laptop", "Laptop", "laptop", ["notebook", "developer-machine", "dev-laptop", "macbook", "local-machine"], "A laptop / developer machine."],
      ["iot-device", "IoT device", "microchip", ["iot", "sensor", "edge-device", "embedded-device", "device", "thing", "raspberry-pi", "plc"], "Sensor, embedded or edge device."],
      ["user", "User", "user", ["end-user", "customer", "client-user", "human", "visitor"], "A single person using the system."],
      ["users", "Users", "users", ["team", "people", "user-group", "customers", "audience", "organization-users"], "A group of users or a team."],
      ["external-service", "External service", "cloud-cog", ["third-party", "saas", "external-api", "third-party-service", "partner-api", "vendor", "stripe", "twilio"], "Third-party SaaS or API outside your control."],
      ["on-prem", "On-premises", "building-2", ["on-premises", "on-premise", "onprem", "office", "corporate-network", "corporate-datacenter", "headquarters", "legacy-system", "mainframe"], "On-premises site, office or legacy data centre."],
    ],
  },
  {
    // Development and delivery
    color: "teal",
    rows: [
      ["git-repo", "Git repository", "git-branch", ["git", "repo", "repository", "github", "gitlab", "bitbucket", "source-control", "source-code", "vcs"], "Source code repository."],
      ["ci-cd", "CI/CD pipeline", "infinity", ["ci", "cd", "cicd", "build-pipeline", "github-actions", "jenkins", "gitlab-ci", "deploy-pipeline", "build-server", "argo-cd", "circleci"], "Build, test and deployment pipeline."],
      ["artifact-registry", "Artifact registry", "package", ["registry", "container-registry", "docker-registry", "ecr", "package-registry", "artifactory", "npm-registry", "image-registry", "docker-hub"], "Registry for container images and build artefacts."],
      ["iac", "Infrastructure as code", "file-code", ["terraform", "pulumi", "cloudformation", "infrastructure-as-code", "ansible", "helm", "helm-chart", "bicep"], "Infrastructure-as-code templates that provision the stack."],
    ],
  },
  {
    // Observability
    color: "yellow",
    rows: [
      ["monitoring", "Monitoring", "gauge", ["metrics", "prometheus", "datadog", "cloudwatch", "observability", "apm", "new-relic", "telemetry", "health-check"], "Metrics collection and health monitoring."],
      ["logging", "Logging", "logs", ["logs", "log-aggregation", "elk", "loki", "splunk", "log-store", "audit-log", "cloud-logging"], "Central log aggregation and search."],
      ["tracing", "Tracing", "route", ["distributed-tracing", "jaeger", "opentelemetry", "otel", "zipkin", "traces", "tempo"], "Distributed request tracing."],
      ["alerting", "Alerting", "bell", ["alerts", "alert-manager", "pagerduty", "on-call", "opsgenie", "incident", "notifications"], "Alert rules and on-call notifications."],
      ["dashboard", "Dashboard", "layout-dashboard", ["grafana", "kibana", "metrics-dashboard", "bi-dashboard", "status-page", "analytics-dashboard", "looker", "tableau"], "Dashboard visualising metrics or business data."],
    ],
  },
];

const tiles: ShapeDef[] = CATEGORIES.flatMap(({ color, rows }) =>
  rows.map(([id, name, glyph, aliases, description]) => iconTile({ id: `infra/${id}`, name, icon: glyph, color, aliases, description })),
);

export const infraLibrary: ShapeLibrary = {
  id: "infra",
  name: "Infrastructure & cloud",
  description:
    "Vendor-neutral infrastructure, network and cloud building blocks, colour coded by category (compute blue, data green, messaging orange, network purple, security red, clients gray, delivery teal, observability yellow), plus region / VPC / subnet / cluster containers.",
  shapes: [...tiles, ...zones.map(zoneContainer)],
};
