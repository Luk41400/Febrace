import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = await readFile(resolve(projectRoot, "file-protocol-redirect.js"), "utf8");

function destinationFor(address) {
  const { protocol, hostname, pathname, search, hash } = new URL(address);
  let destination = null;
  runInNewContext(source, {
    window: {
      location: {
        protocol, hostname, pathname, search, hash,
        replace: (value) => { destination = value; },
      },
    },
  });
  return destination;
}

test("GitHub Pages redireciona para Vercel preservando query e fragmento", () => {
  assert.equal(destinationFor("https://luk41400.github.io/Febrace/"), "https://febrace.vercel.app/");
  assert.equal(destinationFor("https://luk41400.github.io/Febrace/#alguma-coisa"), "https://febrace.vercel.app/#alguma-coisa");
  assert.equal(destinationFor("https://luk41400.github.io/Febrace/?x=1"), "https://febrace.vercel.app/?x=1");
  assert.equal(destinationFor("https://luk41400.github.io/Febrace/?x=1#alguma-coisa"), "https://febrace.vercel.app/?x=1#alguma-coisa");
  assert.equal(destinationFor("https://luk41400.github.io/Febrace/antigo/?x=1#topo"), "https://febrace.vercel.app/antigo/?x=1#topo");
});

test("redirecionamento local permanece restrito a file://", () => {
  assert.equal(destinationFor("file:///C:/projeto/index.html"), "http://localhost:3000/");
  assert.equal(destinationFor("http://localhost:3000/"), null);
  assert.equal(destinationFor("https://febrace.vercel.app/"), null);
  assert.equal(destinationFor("https://outro.github.io/Febrace/"), null);
  assert.equal(destinationFor("https://luk41400.github.io/FebraceOutra/"), null);
});

test("redirect carrega antes da interface e também na página 404 do Pages", async () => {
  const index = await readFile(resolve(projectRoot, "index.html"), "utf8");
  const fallback = await readFile(resolve(projectRoot, "404.html"), "utf8");
  const redirectPosition = index.indexOf('<script src="file-protocol-redirect.js"></script>');
  assert.ok(redirectPosition > 0 && redirectPosition < index.indexOf("<body>"));
  assert.ok(redirectPosition < index.indexOf('<script src="theme-init.js"></script>'));
  assert.match(fallback, /<script src="\/Febrace\/file-protocol-redirect\.js"><\/script>/);
});
