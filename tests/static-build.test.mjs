import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import test from "node:test";

const output=new URL("../static-dist/",import.meta.url);

test("creates a portable browser-only application",async()=>{
  const html=await readFile(new URL("index.html",output),"utf8");
  assert.match(html,/\.\/assets\/[^"']+\.js/);
  assert.doesNotMatch(html,/\/_next\//);
  assert.equal((await stat(new URL("favicon.svg",output))).isFile(),true);

  const assets=await readdir(new URL("assets/",output));
  const javascript=await Promise.all(assets.filter(name=>name.endsWith(".js")).map(name=>readFile(new URL(`assets/${name}`,output),"utf8")));
  const bundle=javascript.join("\n");
  assert.match(bundle,/api\.tidesandcurrents\.noaa\.gov/);
  assert.doesNotMatch(bundle,/\/api\/noaa\//);

  await assert.rejects(stat(new URL("server/",output)),error=>error?.code==="ENOENT");
});
