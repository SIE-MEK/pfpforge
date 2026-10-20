#!/usr/bin/env node
/* Replaces the YOURDOMAIN.com placeholder everywhere it appears on the site
   (canonical + og: tags, sitemap.xml, robots.txt, privacy/terms contact).

   Usage:
     node scripts/set-domain.mjs siemekpfp.com
     node scripts/set-domain.mjs siemekpfp.com you@example.com   # contact email

   Without the email argument, the contact address becomes hello@<domain>.
   Run it once, then commit and push. */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const [domainArg, emailArg] = process.argv.slice(2);
const domain = (domainArg || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
  console.error("Usage: node scripts/set-domain.mjs yourdomain.com [contact@email]");
  process.exit(1);
}
if (emailArg && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailArg)) {
  console.error(`"${emailArg}" doesn't look like an email address.`);
  process.exit(1);
}

const root = new URL("..", import.meta.url).pathname;
const SKIP = new Set(["node_modules", ".git", ".netlify", "scripts", "netlify", "lib"]);
const EXT = new Set([".html", ".xml", ".txt"]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXT.has(extname(p))) yield p;
  }
}

let files = 0, hits = 0;
for (const file of walk(root)) {
  const before = readFileSync(file, "utf8");
  let after = before;
  if (emailArg) after = after.replaceAll("hello@YOURDOMAIN.com", emailArg);
  after = after.replaceAll("YOURDOMAIN.com", domain);
  if (after !== before) {
    hits += before.split("YOURDOMAIN.com").length - 1;
    files++;
    writeFileSync(file, after);
    console.log("updated", file.slice(root.length));
  }
}
console.log(files ? `\nDone: ${hits} placeholder(s) in ${files} file(s) now use ${domain}.`
                  : "Nothing to replace: the domain is already set.");
