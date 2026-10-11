import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { importIconFiles, importIconFilesAsync, importIconZip, parseIconFileName, readZip } from "./pack-import";

const icon = (fill: string, body = '<path d="M4 4h16v16H4z"/>') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="${fill}">${body}</g></svg>`;

describe("parseIconFileName", () => {
  it.each([
    ["Arch_AWS-Lambda_64.svg", "AWS Lambda", 64],
    ["Arch_Amazon-Simple-Storage-Service_48.svg", "Amazon Simple Storage Service", 48],
    ["Res_Amazon-EC2_Instance_48.svg", "Amazon EC2 Instance", 48],
    ["Arch-Category_Compute_32.svg", "Compute", 32],
    ["10021-icon-service-Virtual-Machine.svg", "Virtual Machine", undefined],
    ["compute_engine.svg", "Compute Engine", undefined],
    ["cloud_sql.svg", "Cloud SQL", undefined],
    ["Office-365.svg", "Office 365", undefined],
    ["folder/sub/Arch_Amazon-RDS_16.svg", "Amazon RDS", 16],
  ])("%s", (file, name, size) => {
    expect(parseIconFileName(file)).toEqual({ name, size });
  });
});

describe("importIconFiles: vendor layouts", () => {
  it("reads an AWS-style tree: categories from Arch_/Res_ folders, one icon per name, 48/64 px preferred", () => {
    const root = "Asset-Package_01312023.d9e29db8/Architecture-Service-Icons_01312023";
    const files = [
      { path: `${root}/Arch_Compute/16/Arch_AWS-Lambda_16.svg`, data: icon("#161616") },
      { path: `${root}/Arch_Compute/48/Arch_AWS-Lambda_48.svg`, data: icon("#484848") },
      { path: `${root}/Arch_Compute/32/Arch_AWS-Lambda_32.svg`, data: icon("#323232") },
      { path: `${root}/Arch_Compute/48/Arch_Amazon-EC2_48.svg`, data: icon("#ec2000") },
      { path: `${root}/Arch_Storage/48/Arch_Amazon-Simple-Storage-Service_48.svg`, data: icon("#7aa116") },
      { path: "Asset-Package_01312023.d9e29db8/Resource-Icons_01312023/Res_Storage/Res_Amazon-S3-Bucket_48.svg", data: icon("#b00b00") },
      { path: "__MACOSX/Asset-Package_01312023/._Arch_AWS-Lambda_48.svg", data: "junk" },
      { path: `${root}/readme.txt`, data: "hello" },
    ];
    const report = importIconFiles(files, { name: "AWS Architecture Icons" });
    const pack = report.pack!;
    expect(pack.id).toBe("aws-architecture-icons");
    expect(pack.icons.map((i) => `${i.category}/${i.name}`)).toEqual([
      "Compute/Amazon EC2",
      "Compute/AWS Lambda",
      "Storage/Amazon S3 Bucket",
      "Storage/Amazon Simple Storage Service",
    ]);
    const lambda = pack.icons.find((i) => i.name === "AWS Lambda")!;
    expect(lambda.layers[0].fill).toBe("#484848");
    expect(report.skipped.filter((s) => /Another size/.test(s.reason))).toHaveLength(2);
  });

  it("reads an Azure-style tree: numeric prefixes and wrapper folders disappear", () => {
    const files = [
      { path: "Azure_Public_Service_Icons/Icons/analytics/00001-icon-service-Analysis-Services.svg", data: icon("#0078d4") },
      { path: "Azure_Public_Service_Icons/Icons/analytics/00002-icon-service-Data-Explorer-Clusters.svg", data: icon("#0078d4") },
      { path: "Azure_Public_Service_Icons/Icons/compute/10021-icon-service-Virtual-Machine.svg", data: icon("#0078d4") },
    ];
    const pack = importIconFiles(files, { name: "Azure Architecture Icons" }).pack!;
    expect(pack.icons.map((i) => [i.category, i.name, i.id])).toEqual([
      ["Analytics", "Analysis Services", "analysis-services"],
      ["Analytics", "Data Explorer Clusters", "data-explorer-clusters"],
      ["Compute", "Virtual Machine", "virtual-machine"],
    ]);
  });

  it("reads a flat GCP-style folder: names from file names, no category", () => {
    const files = ["compute_engine", "cloud_sql", "bigquery"].map((name) => ({ path: `${name}.svg`, data: icon("#4285f4") }));
    const pack = importIconFiles(files, { name: "Google Cloud" }).pack!;
    expect(pack.icons.map((i) => i.name)).toEqual(["Bigquery", "Cloud SQL", "Compute Engine"]);
    expect(pack.icons.every((i) => i.category === undefined)).toBe(true);
  });

  it("keeps same-named icons from different categories apart", () => {
    const files = [
      { path: "Networking/Gateway.svg", data: icon("#111111") },
      { path: "Security/Gateway.svg", data: icon("#222222") },
    ];
    const pack = importIconFiles(files, { name: "Mixed" }).pack!;
    expect(new Set(pack.icons.map((i) => i.id)).size).toBe(2);
    expect(pack.icons.map((i) => i.id)).toContain("gateway");
  });
});

describe("importIconFiles: failures and limits", () => {
  it("skips unreadable files with a reason and still imports the rest", () => {
    const report = importIconFiles(
      [
        { path: "good.svg", data: icon("#123456") },
        { path: "broken.svg", data: "<svg><oops" },
        { path: "empty.svg", data: '<svg viewBox="0 0 8 8"></svg>' },
      ],
      { name: "Partial" },
    );
    expect(report.pack!.icons).toHaveLength(1);
    expect(report.skipped.map((s) => s.path).sort()).toEqual(["broken.svg", "empty.svg"]);
  });

  it("returns no pack when nothing can be read", () => {
    const report = importIconFiles([{ path: "notes.txt", data: "nope" }], { name: "Nothing" });
    expect(report.pack).toBeNull();
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it("stops at the icon limit with a warning", () => {
    const files = Array.from({ length: 2005 }, (_, i) => ({ path: `Group/Icon x${String(i).padStart(4, "0")}.svg`, data: icon("#112233") }));
    const report = importIconFiles(files, { name: "Huge" });
    expect(report.pack!.icons).toHaveLength(2000);
    expect(report.warnings.join(" ")).toMatch(/left out/);
  });

  it("reports progress in the async variant and matches the sync result", async () => {
    const files = Array.from({ length: 60 }, (_, i) => ({ path: `icon-${i}.svg`, data: icon("#112233") }));
    const calls: number[] = [];
    const report = await importIconFilesAsync(files, { name: "Async" }, (done) => calls.push(done));
    expect(calls.at(-1)).toBe(60);
    expect(report.pack).toEqual(importIconFiles(files, { name: "Async" }).pack);
  });

  it("uses an explicit id and rejects an invalid one", () => {
    const files = [{ path: "a.svg", data: icon("#112233") }];
    expect(importIconFiles(files, { name: "Whatever", id: "my-icons" }).pack!.id).toBe("my-icons");
    expect(importIconFiles(files, { name: "Whatever", id: "Not Valid" }).pack).toBeNull();
  });
});

describe("zip import", () => {
  const archive = (entries: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(entries).map(([name, text]) => [name, strToU8(text)])));

  it("imports a multi-folder archive", () => {
    const zip = archive({
      "Set/Compute/Compute Engine.svg": icon("#4285f4"),
      "Set/Compute/App_Engine.svg": icon("#4285f4"),
      "Set/Data/BigQuery.svg": icon("#669df6"),
      "Set/README.md": "# not an icon",
    });
    const report = importIconZip(zip, { name: "GCP" });
    expect(report.pack!.icons.map((i) => `${i.category}/${i.name}`)).toEqual(["Compute/App Engine", "Compute/Compute Engine", "Data/BigQuery"]);
  });

  it("rejects something that is not a zip", () => {
    expect(readZip(strToU8("plain text"))).toBeNull();
    expect(importIconZip(strToU8("plain text"), { name: "x" }).pack).toBeNull();
  });
});
