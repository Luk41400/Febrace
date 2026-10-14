import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const index = await readFile(resolve(projectRoot, "index.html"), "utf8");
const fallback = await readFile(resolve(projectRoot, "404.html"), "utf8");
const localScript = await readFile(resolve(projectRoot, "file-protocol-redirect.js"), "utf8");

function inlineRedirect(html) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1];
  assert.ok(head, "HTML precisa ter um <head>");
  const script = head.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "redirecionamento precisa estar inline no <head>");
  return script.replace(/\r\n?/g, "\n");
}

function destinationFor(source, address) {
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

test("index e 404 redirecionam diretamente para Vercel com caminho, query e hash", () => {
  const indexScript = inlineRedirect(index);
  assert.equal(inlineRedirect(fallback), indexScript);
  for (const source of [indexScript, inlineRedirect(fallback)]) {
    assert.equal(destinationFor(source, "https://luk41400.github.io/Febrace/"), "https://febrace.vercel.app/");
    assert.equal(destinationFor(source, "https://luk41400.github.io/Febrace/?teste=1"), "https://febrace.vercel.app/?teste=1");
    assert.equal(destinationFor(source, "https://luk41400.github.io/Febrace/#assistente"), "https://febrace.vercel.app/#assistente");
    assert.equal(destinationFor(source, "https://luk41400.github.io/Febrace/rota/?teste=1#assistente"), "https://febrace.vercel.app/rota/?teste=1#assistente");
    assert.equal(destinationFor(source, "https://febrace.vercel.app/"), null);
    assert.equal(destinationFor(source, "http://localhost:3000/"), null);
    assert.equal(destinationFor(source, "https://outro.github.io/Febrace/"), null);
  }
});

test("redirecionamento inline é o primeiro código no head e tem hash CSP exato", async () => {
  const scriptStart = index.indexOf("<script>");
  assert.ok(scriptStart > index.indexOf("<head>"));
  assert.ok(scriptStart < index.indexOf('src="file-protocol-redirect.js"'));
  assert.ok(scriptStart < index.indexOf('src="theme-init.js"'));
  assert.ok(scriptStart < index.indexOf('href="styles.css"'));
  assert.ok(scriptStart < index.indexOf('href="ai-assistant.css"'));
  assert.ok(scriptStart < index.indexOf("<body>"));

  const digest = createHash("sha256").update(inlineRedirect(index)).digest("base64");
  const security = await readFile(resolve(projectRoot, "lib", "request-security.js"), "utf8");
  assert.ok(security.includes(`'sha256-${digest}'`));
});

test("file:// continua apontando para localhost sem alterar outros hosts", () => {
  assert.equal(destinationFor(localScript, "file:///C:/projeto/index.html"), "http://localhost:3000/");
  assert.equal(destinationFor(localScript, "http://localhost:3000/"), null);
});
