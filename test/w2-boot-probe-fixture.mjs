// w2-boot-probe-fixture.mjs — load one module with no W2 environment, and say so.
//
// The W2 variables are DELETED rather than left alone: the office this proves is
// the one prod boots, and there they are absent. A probe that inherited a flag
// from whatever ran it would prove the wrong office.

for (const k of ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN"]) delete process.env[k];

await import(process.env.W2_PROBE_TARGET);
console.log("BOOTED");
