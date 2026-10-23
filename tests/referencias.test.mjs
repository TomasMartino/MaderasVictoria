/* Guarda anti-ReferenceError: en app.js cada identificador el* que se usa
 * (elAlgo.algo) tiene que estar declarado con var. Si falta, la app en
 * vivo crashea a mitad del arranque y se clava en el login, asi que lo
 * detectamos acá antes de que llegue al usuario. */
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

test("app.js: todo identificador usar* déclaré", () => {
  const src = readFileSync(new URL("../app/js/app.js", import.meta.url), "utf8");

  // declaraciones: var elXxx = $("#...")
  const declaradas = new Set(
    [...src.matchAll(/var\s+(el[A-Z]\w+)\s*=/g)].map((m) => m[1])
  );

  // usos: elXxx.something (acceso a propiedad)
  const usadas = new Set(
    [...src.matchAll(/(?:^|[\s(,])((el[A-Z]\w+))\.\w/g)].map((m) => m[1])
  );

  const faltan = [...usadas].filter((n) => !declaradas.has(n));
  assert.deepEqual(
    faltan,
    [],
    "Identificadores el* usados sin declarar: " + faltan.join(", ")
  );
});
