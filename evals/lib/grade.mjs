// Scores one outcome (the calendar changes the app would apply) against a case's `expect`.
// Returns { pass, reasons[] }. Every reason is a human-readable failure.

const NUMERIC = new Set(['start', 'end', 'days']);

function fieldOk(field, want, got) {
  if (got === undefined) return false;
  if (NUMERIC.has(field)) {
    if (Array.isArray(want)) return got >= want[0] && got <= want[1];
    return got === want;
  }
  if (field === 'allDay') return !!got === want;
  if (field === 'title') return new RegExp(want, 'i').test(String(got));
  const any = Array.isArray(want) ? want : [want];
  return any.some((w) => String(w).toLowerCase() === String(got).toLowerCase());
}

function fmt(v) { return JSON.stringify(v); }

function matchFields(want, got, prefix) {
  const bad = [];
  for (const [f, w] of Object.entries(want)) {
    if (!fieldOk(f, w, got[f])) bad.push(`${prefix}${f} expected ${fmt(w)}, got ${fmt(got[f])}`);
  }
  return bad;
}

// Order-independent: tries every pairing of expected to actual (same length) and keeps the one with fewest failures.
function bestPairing(wants, gots, check) {
  let best = null;
  const used = new Array(gots.length).fill(false);
  const walk = (i, acc) => {
    if (best && best.length === 0) return;
    if (i === wants.length) { if (!best || acc.length < best.length) best = acc; return; }
    for (let j = 0; j < gots.length; j++) {
      if (used[j]) continue;
      used[j] = true;
      walk(i + 1, acc.concat(check(wants[i], gots[j], i)));
      used[j] = false;
    }
  };
  walk(0, []);
  return best || [];
}

export function grade(outcome, expect, events) {
  const reasons = [];
  if (outcome.error && !(expect.safe && outcome.error === 'empty')) {
    return { pass: false, reasons: ['error: ' + outcome.error] };
  }
  const creates = outcome.creates || [], updates = outcome.updates || [], deletes = outcome.deletes || [];
  const goals = outcome.goals || [], asks = outcome.asks || [];
  const edits = creates.length + updates.length + deletes.length + goals.length;

  if (expect.safe) {
    if (edits) reasons.push(`expected no changes, got ${creates.length} create / ${updates.length} update / ${deletes.length} delete / ${goals.length} goal`);
    return { pass: reasons.length === 0, reasons };
  }

  for (const issue of outcome.issues || []) reasons.push('code check: ' + issue);

  if (expect.asks) {
    if (!asks.length) reasons.push('expected a clarifying question, got none');
    if (edits) reasons.push(`expected only questions, but it also made ${edits} change(s)`);
    return { pass: reasons.length === 0, reasons };
  }
  if (asks.length) reasons.push(`asked ${asks.length} question(s) instead of acting: ${fmt(asks.map((a) => a.q))}`);

  const wantC = expect.creates || [], wantU = expect.updates || [], wantD = expect.deletes || [];

  if (creates.length !== wantC.length) reasons.push(`expected ${wantC.length} create(s), got ${creates.length}`);
  else reasons.push(...bestPairing(wantC, creates, (w, g, i) => matchFields(w, g, `create #${i + 1} `)));

  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  if (updates.length !== wantU.length) reasons.push(`expected ${wantU.length} update(s), got ${updates.length}: ${fmt(updates.map((u) => u.id))}`);
  else reasons.push(...bestPairing(wantU, updates, (w, g, i) => {
    const ids = Array.isArray(w.id) ? w.id : [w.id];
    if (!ids.includes(g.id)) return [`update #${i + 1} changed ${g.id}, expected ${ids.join(' or ')}`];
    const bad = matchFields(w.patch || {}, g.patch, `update ${g.id} `);
    for (const f of w.keep || []) {
      if (g.patch[f] !== undefined && g.patch[f] !== byId[g.id][f]) bad.push(`update ${g.id} changed ${f} to ${fmt(g.patch[f])} (should stay ${fmt(byId[g.id][f])})`);
    }
    return bad;
  }));

  const gotD = [...deletes].sort(), expD = [...wantD].sort();
  if (fmt(gotD) !== fmt(expD)) reasons.push(`expected deletes ${fmt(expD)}, got ${fmt(gotD)}`);
  if (goals.length && !expect.goals) reasons.push(`unexpected goal change(s): ${goals.length}`);

  return { pass: reasons.length === 0, reasons };
}
