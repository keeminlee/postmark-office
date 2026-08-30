-- 005 — the candle must tile time (ALTER migration; the A/B pass's findings 1+2)
--
-- FOUND LIVE 2026-08-28 by the A/B jetto: window 150 closed 08-26 05:45Z,
-- window 151 was hand-bootstrapped open at 08-28 16:40Z — a 58.9-hour hole with
-- no open candle. An act that fell into it (wright/lab-cairn) reached `acts`
-- with no claims row and NO REFUSAL: the log says a resident submitted, the
-- docket never received it, nothing noticed. Gold §1 promises the door refuses
-- while you stand there — a hole neither accepts nor refuses. The
-- states-with-no-receipt class, arriving in the new substrate on day one.
--
-- Two guards: (a) this trigger — a window OPENS WHERE ITS PREDECESSOR CLOSED,
-- so the hole is unrepresentable from here on; (b) the closure falsifier
-- (world2/tools/falsifier-acts-claims-closure.mjs) — every mark-class act has
-- its docket row, red otherwise.
--
-- The one existing hole (150→151) is repaired here by moving 151's opens_at
-- back to 150's close: the candle's law is that everything submitted since the
-- last close belongs to the next window — 151's span always MEANT that.

BEGIN;

UPDATE windows w SET opens_at = p.closes_at
  FROM windows p
  WHERE w.id = 151 AND p.id = 150 AND w.opens_at > p.closes_at;

CREATE FUNCTION windows_tile() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev_close timestamptz;
BEGIN
  SELECT closes_at INTO prev_close FROM windows WHERE id = NEW.id - 1;
  IF prev_close IS NOT NULL AND NEW.opens_at IS DISTINCT FROM prev_close THEN
    RAISE EXCEPTION 'window % must open where % closed (% <> %) — the candle tiles time; a hole is an act nobody receives',
      NEW.id, NEW.id - 1, NEW.opens_at, prev_close;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER windows_tile BEFORE INSERT ON windows
  FOR EACH ROW EXECUTE FUNCTION windows_tile();

UPDATE registry SET ruling = ruling || ' + 005: windows tile (trigger), acts-claims closure falsifier'
  WHERE object = 'windows';

COMMIT;
