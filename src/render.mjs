import { DiscoveryError, ID, KINDS, isObject, nonempty, canonical, dependencies, lifecycle, projectGraph, operativeClosure } from './graph.mjs';

// The handoff is a projection of the graph. Every node falls into one class, derived from
// the shared LIFECYCLE and the node's links:
// - current: not retired; options only while chosen or open, arguments while they bear on current nodes;
// - retained: not current, but a current node still depends on it, so it is shown with its text;
// - history: earlier versions, resolutions, reviews and consequences, listed by ID beside their record;
// - not chosen: everything else, folded into conclusions that the agent writes at handoff.
// Bump RENDERER whenever the same graph, language and conclusions would render different bytes.
export const RENDERER = 1;
export const MAX_CONCLUSION = 2000;

const ids = x => Array.isArray(x) ? x : [];
const st = n => n?.data.status;
const normal = text => String(text).replace(/\s+/g, ' ').trim();
const requires = n => [...dependencies(n), ...ids(n.data.challenged_by)];

function indexGraph(graph) {
  const { nodes } = graph, order = new Map([...nodes.keys()].map((id, i) => [id, i])), maps = {};
  const push = (name, key, value) => { if (key === undefined || key === null) return; maps[name] ??= new Map(); if (!maps[name].has(key)) maps[name].set(key, []); maps[name].get(key).push(value); };
  for (const r of graph.relations) { push('out', r.from, r); push('into', r.to, r); }
  for (const n of nodes.values()) {
    if (['position', 'argument'].includes(n.kind)) push('attached', n.data.issue, n.id);
    if (n.kind === 'issue') { push('children', n.data.parent, n.id); push('answers', n.data.resolved_by, n.id); for (const r of ids(n.data.resolution_history)) push('formerlyAnswers', r, n.id); }
    if (n.kind === 'review') push('reviews', n.data.decision, n.id);
    if (n.kind === 'consequence') push('effects', n.data.derives_from, n.id);
    for (const dep of new Set(requires(n))) push('requirers', dep, n.id);
  }
  const get = name => key => maps[name]?.get(key) ?? [];
  const out = get('out'), into = get('into');
  return { order, out, into, operative: operativeClosure(graph).reachable, attached: get('attached'), children: get('children'), answers: get('answers'), formerlyAnswers: get('formerlyAnswers'),
    reviews: get('reviews'), effects: get('effects'), requirers: get('requirers'),
    partners: id => [...out(id).map(r => r.to), ...into(id).map(r => r.from)],
    byOrder: list => [...new Set(list)].sort((a, b) => order.get(a) - order.get(b)) };
}

function classify(graph, ix, folded = new Set()) {
  const { nodes, meta } = graph, current = new Set();
  for (const n of nodes.values()) {
    if (folded.has(n.id)) continue;
    if (n.id === meta.root) current.add(n.id);
    else if (n.kind === 'position') { if (st(n) === 'accepted' || (st(n) === 'proposed' && lifecycle(nodes.get(n.data.issue)) === 'unsettled')) current.add(n.id); }
    else if (!['argument', 'review'].includes(n.kind) && lifecycle(n) !== 'retired') current.add(n.id);
  }
  // A review is current for a current decision unless a later review in its chain replaced it.
  for (const n of nodes.values()) if (n.kind === 'review' && !folded.has(n.id) && !n.data.superseded_by && current.has(n.data.decision)) {
    const chain = ids(nodes.get(n.data.decision).data.reaffirmed_by);
    if (!chain.includes(n.id) || chain.at(-1) === n.id) current.add(n.id);
  }
  // An argument is current while a current node relies on it or it bears on a current node: through
  // a relation or, without a target, by speaking to a current question without presupposing an option that was left.
  const open = a => a?.kind === 'argument' && st(a) === 'active' && !folded.has(a.id) && !current.has(a.id);
  const bears = a => {
    if (ix.requirers(a.id).some(id => current.has(id))) return true;
    const targets = [...ix.out(a.id).map(r => r.to), ...ix.into(a.id).filter(r => r.type === 'contradictory').map(r => r.from)];
    if (targets.length) return targets.some(id => current.has(id));
    return current.has(a.data.issue) && [...ids(a.data.based_on), ...ids(a.data.depends_on)].every(id => nodes.get(id)?.kind !== 'position' || current.has(id));
  };
  for (const queue = [...nodes.values()].filter(open); queue.length;) {
    const a = queue.pop();
    if (!open(a) || !bears(a)) continue;
    current.add(a.id);
    for (const r of [...ix.into(a.id), ...ix.out(a.id).filter(r => r.type === 'contradictory')]) queue.push(nodes.get(r.from === a.id ? r.to : r.from));
    queue.push(...requires(a).map(id => nodes.get(id)));
  }
  // A reaffirmed decision's latest review supplies its complete basis; the original basis of the
  // decision and of the options it selects is history, as in the operative closure.
  const reaffirmedBy = new Map();
  for (const id of current) {
    const n = nodes.get(id);
    if (n.kind === 'decision' && ids(n.data.reaffirmed_by).length) for (const x of [id, ...ids(n.data.selected)]) reaffirmedBy.set(x, id);
  }
  // Retained: what the operative state still relies on although it is no longer current itself.
  const retained = new Set([...ix.operative].filter(id => !current.has(id) && !folded.has(id)));
  const shown = id => current.has(id) || retained.has(id), history = new Map(), recordOf = id => shown(id) ? id : history.get(id)?.target;
  const assign = (id, target, role) => nodes.has(id) && target && !shown(id) && !folded.has(id) && !history.has(id) && Boolean(history.set(id, { target, role }));
  for (let changed = true; changed;) {
    changed = false;
    for (const n of nodes.values()) if (!shown(n.id) && !history.has(n.id) && !folded.has(n.id)) {
      changed = assign(n.id, n.data.superseded_by && recordOf(n.data.superseded_by), 'version') ||
        (n.kind === 'review' && assign(n.id, recordOf(n.data.decision), 'review')) || (n.kind === 'consequence' && assign(n.id, recordOf(n.data.derives_from), 'consequence')) || changed;
    }
    for (const id of [...current, ...retained]) {
      const n = nodes.get(id);
      if (n.kind === 'issue') for (const r of ids(n.data.resolution_history)) if (r !== n.data.resolved_by) changed = assign(r, id, 'resolution') || changed;
      if (reaffirmedBy.has(id)) for (const b of [...ids(n.data.based_on), ...ids(n.data.depends_on)]) changed = assign(b, id, 'basis') || changed;
    }
  }
  return { current, retained, history, shown, reaffirmedBy, pruned: new Set([...nodes.keys()].filter(id => !shown(id) && !history.has(id))) };
}

// The class of every node before any folding: current, retained, history or pruned (not chosen).
export function classifyGraph(graph) {
  const cls = classify(graph, indexGraph(graph));
  return { current: cls.current, retained: cls.retained, history: cls.history, pruned: cls.pruned };
}

function treeOf(graph, cls) {
  const { nodes, meta } = graph, kids = new Map(), order = [], depth = new Map();
  const up = id => { let p = nodes.get(id)?.data.parent; while (p && nodes.has(p) && !cls.current.has(p)) p = nodes.get(p).data.parent; return p && cls.current.has(p) ? p : meta.root; };
  for (const n of nodes.values()) if (n.kind === 'issue' && n.id !== meta.root && cls.current.has(n.id)) { const p = up(n.id); if (!kids.has(p)) kids.set(p, []); kids.get(p).push(n.id); }
  for (const stack = [[meta.root, 0]]; stack.length;) {
    const [id, level] = stack.pop(); order.push(id); depth.set(id, level);
    for (const child of [...(kids.get(id) ?? [])].reverse()) stack.push([child, level + 1]);
  }
  return { up, order, depth, position: new Map(order.map((id, i) => [id, i])) };
}

// The current issue under which a node outside the current state is reported: follow its
// question, decision, record, answered question or first related node until an issue.
function anchorer(graph, ix, cls, tree) {
  const { nodes, meta } = graph, memo = new Map();
  const next = n => [n.data.issue, n.kind === 'decision' ? ids(n.data.resolves)[0] : undefined, n.kind === 'review' ? n.data.decision : undefined, n.data.derives_from,
    ix.answers(n.id)[0], ix.formerlyAnswers(n.id)[0], ix.partners(n.id)[0]].find(id => id && nodes.has(id));
  return id => {
    const trail = [], seen = new Set();
    let cursor = id, result;
    while (result === undefined) {
      const n = nodes.get(cursor);
      if (memo.has(cursor)) result = memo.get(cursor);
      else if (n.kind === 'issue') result = cursor !== id && cls.current.has(cursor) ? cursor : tree.up(cursor);
      else if (seen.has(cursor) || !next(n)) result = meta.root;
      else { seen.add(cursor); trail.push(cursor); cursor = next(n); }
    }
    for (const t of trail) memo.set(t, result);
    return result;
  };
}

// Only reasoning, facts, unsettled boundaries and fact-answered questions can be folded; the
// projection's commitments and blockers stay visible.
const foldable = (graph, required, n) => !required.has(n.id) && (['argument', 'evidence'].includes(n.kind) || (n.kind === 'constraint' && lifecycle(n) === 'unsettled') ||
  (n.kind === 'issue' && n.id !== graph.meta.root && st(n) === 'resolved' && graph.nodes.get(n.data.resolved_by)?.kind !== 'decision'));
const neighbours = (ix, n) => [...ix.requirers(n.id), ...ix.partners(n.id), ...(n.kind === 'issue' ? [...ix.children(n.id), ...ix.attached(n.id)] : [])];

export const LANGUAGES = ['en', 'uk'];
export function handoffInput(input) {
  if (!isObject(input)) throw new DiscoveryError('INPUT', 'handoff expects a JSON object {language?, conclusions?, review?, audit_requested?} on stdin.');
  if (Object.hasOwn(input, 'body') || Object.hasOwn(input, 'covers')) throw new DiscoveryError('INPUT', 'The handoff body is rendered from the graph. Supply branch conclusions instead of body/covers: {language?, conclusions?, review?, audit_requested?}.');
  const unknown = Object.keys(input).filter(k => !['language', 'conclusions', 'review', 'audit_requested'].includes(k));
  if (unknown.length) throw new DiscoveryError('INPUT', `Unknown handoff input fields: ${unknown.join(', ')}.`);
  if (input.audit_requested !== undefined && typeof input.audit_requested !== 'boolean') throw new DiscoveryError('INPUT', 'audit_requested must be boolean.');
  if (input.language !== undefined && !(typeof input.language === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(input.language) && LANGUAGES.includes(input.language.split('-')[0].toLowerCase()))) {
    throw new DiscoveryError('INPUT', `language must be a tag of a supported label language: ${LANGUAGES.join(', ')}. Use the closest one; node texts stay in their own language.`);
  }
  if (input.conclusions !== undefined && !Array.isArray(input.conclusions)) throw new DiscoveryError('INPUT', 'conclusions must be an array of {issue, covers, text}.');
  const conclusions = (input.conclusions ?? []).map((c, i) => {
    const where = `conclusion ${i + 1}`;
    if (!isObject(c) || Object.keys(c).some(k => !['issue', 'covers', 'text'].includes(k))) throw new DiscoveryError('INPUT', `${where}: use exactly {issue, covers, text}.`);
    if (typeof c.issue !== 'string' || !ID.test(c.issue)) throw new DiscoveryError('INPUT', `${where}: issue must be the ID of the current issue it is shown under.`);
    if (!Array.isArray(c.covers) || !c.covers.length || c.covers.some(id => typeof id !== 'string') || new Set(c.covers).size !== c.covers.length) throw new DiscoveryError('INPUT', `${where}: covers must be a nonempty array of unique node IDs.`);
    if (!nonempty(c.text) || normal(c.text).length > MAX_CONCLUSION) throw new DiscoveryError('INPUT', `${where}: text must be a short nonempty conclusion of at most ${MAX_CONCLUSION} characters.`);
    return { issue: c.issue, covers: [...c.covers], text: normal(c.text) };
  });
  return { language: input.language ?? 'en', conclusions };
}

// Checks the conclusions against the classification they produce, in one pass after folding.
function settle(graph, ix, required, conclusions) {
  const { nodes } = graph, base = classify(graph, ix), errors = [], coveredBy = new Map(), folded = new Set();
  conclusions.forEach((c, i) => {
    if (nodes.get(c.issue)?.kind !== 'issue') errors.push(`conclusion ${i + 1}: ${c.issue} is not an issue of this graph.`);
    for (const id of c.covers) {
      if (!nodes.has(id)) errors.push(`conclusion ${i + 1}: ${id} is not a node of this graph.`);
      else if (coveredBy.has(id)) errors.push(`${id}: covered by conclusions ${coveredBy.get(id) + 1} and ${i + 1}; cover each node once.`);
      else coveredBy.set(id, i);
    }
  });
  for (const id of coveredBy.keys()) if (base.current.has(id)) {
    const n = nodes.get(id);
    if (foldable(graph, required, n)) folded.add(id); else errors.push(`${id}: a current ${n.kind} (${st(n)}) is a commitment or an open point; a conclusion cannot hide it.`);
  }
  const cls = classify(graph, ix, folded);
  for (const id of folded) for (const other of neighbours(ix, nodes.get(id))) if (cls.shown(other)) {
    const n = nodes.get(id);
    errors.push(ix.requirers(id).includes(other) ? `${id}: ${other} still depends on it; keep ${id} or fold ${other} with it.`
      : ix.partners(id).includes(other) ? `${id}: bears on ${other}, which stays current; fold only reasoning and facts that bear solely on the abandoned branch.`
      : `${other}: belongs to folded ${n.id}; cover it in the same branch or keep ${n.id}.`);
  }
  // A conclusion folds its own branch: questions under its issue, and nodes linked to the rest of what it covers.
  const under = (id, anchor) => { for (let p = id; p && nodes.has(p); p = nodes.get(p).data.parent) if (p === anchor) return true; return false; };
  conclusions.forEach((c, i) => {
    const members = new Set(c.covers);
    for (const id of c.covers) if (folded.has(id)) {
      const n = nodes.get(id), links = [...neighbours(ix, n), ...requires(n), n.data.issue, n.data.parent].filter(other => other && other !== id);
      if (n.kind === 'issue' && !under(id, c.issue)) errors.push(`${id}: not under ${c.issue}; a conclusion folds the questions of its own branch.`);
      else if (!links.some(other => members.has(other))) errors.push(`${id}: not linked to the other nodes of conclusion ${i + 1}; fold only what belongs to its branch.`);
    }
  });
  for (const id of coveredBy.keys()) {
    if (cls.retained.has(id)) errors.push(`${id}: ${ix.requirers(id).filter(cls.shown).join(', ')} still depends on it, so it is shown as a retired node, not in a conclusion.`);
    else if (cls.history.has(id)) errors.push(`${id}: a ${cls.history.get(id).role} record of ${cls.history.get(id).target}; it is listed there, not in a conclusion.`);
  }
  conclusions.forEach((c, i) => { if (nodes.get(c.issue)?.kind === 'issue' && !cls.current.has(c.issue)) errors.push(`conclusion ${i + 1}: ${c.issue} is not in the current tree; anchor the conclusion at a current issue.`); });
  if (errors.length) throw new DiscoveryError('CONCLUSION', 'Branch conclusions do not match the graph.', [...new Set(errors)]);
  const tree = treeOf(graph, cls), selfConcluded = new Map(), uncovered = [];
  // A dropped issue already records why it was closed; it concludes itself and the options and arguments attached to it.
  for (const id of cls.pruned) if (!coveredBy.has(id) && nodes.get(id).kind === 'issue') selfConcluded.set(id, []);
  for (const id of cls.pruned) if (!coveredBy.has(id) && !selfConcluded.has(id)) {
    const home = nodes.get(id).data.issue;
    if (selfConcluded.has(home)) selfConcluded.get(home).push(id); else uncovered.push(id);
  }
  return { base, cls, tree, anchor: anchorer(graph, ix, cls, tree), coveredBy, folded, selfConcluded, uncovered };
}

function groups(graph, ix, settled, list) {
  const byIssue = new Map();
  for (const id of list) { const issue = settled.anchor(id); if (!byIssue.has(issue)) byIssue.set(issue, []); byIssue.get(issue).push(id); }
  return [...byIssue].sort(([a], [b]) => settled.tree.position.get(a) - settled.tree.position.get(b))
    .map(([issue, members]) => ({ issue, nodes: ix.byOrder(members).map(id => { const n = graph.nodes.get(id); return { id, kind: n.kind, status: st(n), text: normal(n.text).slice(0, 200) }; }) }));
}

// The largest set of foldable current nodes that bears only on branches that were not chosen,
// derived from the same closure that settle enforces and validated by it.
function foldCandidates(graph, ix, required, settled) {
  const { nodes } = graph, { base } = settled, shownOutside = (id, set) => base.shown(id) && !set.has(id);
  const candidates = new Set([...base.current].filter(id => foldable(graph, required, nodes.get(id))));
  for (let changed = true; changed;) {
    changed = false;
    for (const id of candidates) if (neighbours(ix, nodes.get(id)).some(other => shownOutside(other, candidates))) { candidates.delete(id); changed = true; }
  }
  // Keep only what bears on a not-chosen node, plus what must fold with it.
  const reached = new Set(), queue = [...candidates].filter(id => ix.partners(id).some(other => base.pruned.has(other)));
  while (queue.length) {
    const id = queue.pop();
    if (reached.has(id)) continue;
    reached.add(id);
    const n = nodes.get(id);
    queue.push(...[...ix.requirers(id), ...(n.kind === 'issue' ? [...ix.children(id), ...ix.attached(id)] : [])].filter(other => candidates.has(other)));
    queue.push(...requires(n).filter(dep => candidates.has(dep) && ix.requirers(dep).every(other => reached.has(other) || queue.includes(other))));
  }
  const picks = ix.byOrder([...reached]);
  try { if (picks.length) settle(graph, ix, required, [{ issue: graph.meta.root, covers: [...settled.uncovered, ...picks], text: 'Validation of suggested folds.' }]); }
  catch (error) { throw new DiscoveryError('INTERNAL', 'Suggested folds do not pass their own validation.', error.details ?? [String(error.message)]); }
  return picks;
}

const PUNCTUATION = /[!-/:-@[-`{-~]/, WORD = /[\p{L}\p{N}]/u, ENTITY = /^&(?:#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;
function closingRun(text, from, length) {
  for (let j = text.indexOf('`', from); j >= 0; j = text.indexOf('`', j)) {
    let k = j; while (text[k] === '`') k++;
    if (k - j === length) return j;
    j = k;
  }
  return -1;
}
// Escapes recorded text for an inline Markdown position. Balanced backtick runs stay code spans, as written.
export function inline(value) {
  const text = normal(value);
  let out = '';
  for (let i = 0; i < text.length;) {
    const c = text[i], prev = text[i - 1] ?? '', next = text[i + 1] ?? '';
    if (c === '`') {
      const run = /^`+/.exec(text.slice(i))[0], end = closingRun(text, i + run.length, run.length);
      if (end >= 0) { out += text.slice(i, end + run.length); i = end + run.length; } else { out += '\\`'.repeat(run.length); i += run.length; }
      continue;
    }
    if (c === '\\') out += PUNCTUATION.test(next) ? '\\\\' : '\\';
    else if ('*[~'.includes(c)) out += `\\${c}`;
    else if (c === '_') out += WORD.test(prev) && WORD.test(next) ? '_' : '\\_';
    else if (c === '<') out += /[A-Za-z/!?]/.test(next) ? '\\<' : '<';
    else if (c === '&') out += ENTITY.test(text.slice(i)) ? '\\&' : '&';
    else out += c;
    i++;
  }
  return out;
}
// Text that starts a paragraph, list item or quote: block markers at its start stay literal.
export const blockText = value => inline(value).replace(/^(?:#{1,6}(?=\s|$)|>|[-+](?=\s|$)|-(?=(?:\s*-){2,}\s*$)|\d{1,9}(?=[.)](?:\s|$)))/, m => /^\d/.test(m) ? `${m}\\` : `\\${m}`);
const headingText = value => inline(value).replace(/(^|\s)(#+)$/, '$1\\$2');
export function code(value) {
  const text = normal(value), fence = '`'.repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length)) + 1);
  const pad = /^`|`$/.test(text) || /^ .* $/.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

const STATUS_UK = {
  issue: { open: 'відкрите', deferred: 'відкладене', resolved: 'вирішене', dropped: 'зняте' },
  position: { proposed: 'запропоновано', accepted: 'обрано', rejected: 'відхилено', withdrawn: 'відкликано' },
  argument: { active: 'чинний', retired: 'вилучений' },
  evidence: { tentative: 'попередній', verified: 'перевірено', contested: 'оскаржено', stale: 'застарілий', superseded: 'замінено' },
  constraint: { proposed: 'запропоновано', agreed: 'погоджено', verified: 'перевірено', challenged: 'оскаржено', superseded: 'замінено' },
  assumption: { unverified: 'не перевірено', validated: 'підтверджено', invalidated: 'спростовано' },
  decision: { accepted: 'прийнято', challenged: 'оскаржено', superseded: 'замінено', withdrawn: 'відкликано' },
  review: { confirmed: 'підтверджено', challenged: 'оскаржено' },
  consequence: { current: 'чинний', challenged: 'оскаржено', superseded: 'замінено' },
};
const LABELS = {
  en: {
    legend: 'Each `[ID]` is a node of `.requirements/current.argdown`. Texts of current nodes are quoted verbatim. Branches that were not chosen are folded into short conclusions that list their nodes by ID; earlier versions are listed by ID beside the current version.',
    banner: '> BLOCKED — this is a discovery draft, not approved input for Spec Kit.',
    intent: 'Intent', scope: 'Scope', constraints: 'Constraints', facts: 'Facts', tree: 'Questions and decisions', assumptions: 'Assumptions', retained: 'Outside the current state, still referenced', open: 'Open questions',
    decision: 'Decision', review: 'Review', reaffirmed: 'Reaffirmed by review', chosen: 'Chosen', options: 'Options under consideration', arguments: 'Arguments', answer: 'Answer', notChosen: 'Not chosen',
    rationale: 'Rationale', basedOn: 'Based on', dependsOn: 'Depends on', initialBasis: 'Initial basis (the latest review supplies the current one)', initialDependsOn: 'Initial dependencies',
    resolves: 'Also resolves', selected: 'Chosen', alternatives: 'Alternatives', related: 'Related', sources: 'Sources', challengedBy: 'Challenged by', consequences: 'Consequences',
    derivesFrom: 'Derives from', issueRef: 'Question', parent: 'Parent question', supersededBy: 'Replaced by', referencedBy: 'Referenced by',
    supports: 'Supports', attacks: 'Attacks', undercuts: 'Undercuts', supportedBy: 'For', attackedBy: 'Against', undercutBy: 'Undercut by', contradicts: 'Contradicts',
    version: 'Earlier versions', resolution: 'Earlier resolutions', reviewHistory: 'Earlier reviews', consequenceHistory: 'Former consequences',
    validation: 'Validation', nonblockingReason: 'Not blocking', deferReason: 'Deferred', branch: 'Branch', dropped: 'dropped', resolvedBy: 'decision', answeredBy: 'answer', see: 'see', under: 'sub-question of',
    summarizedIn: 'Summarized under', unconcluded: 'No conclusion recorded yet', blocking: 'blocking', nonblocking: 'not blocking', basis: 'basis', quote: ['"', '"'],
    basisKinds: { user: 'user intent', authority: 'normative source' },
    hints: { existing: 'existing', target: 'target', change: 'change', invariant: 'invariant', edge: 'edge case', scope: 'scope' },
    sourceKinds: {}, authorities: {}, status: {}, sourceFields: { revision: 'revision', accessed: 'accessed', symbols: 'symbols', sha256: 'sha256' },
  },
  uk: {
    legend: 'Кожен `[ID]` — вузол `.requirements/current.argdown`. Тексти чинних вузлів наведено дослівно. Гілки, які не обрано, згорнуто в короткі висновки з переліком їхніх вузлів за ID; попередні версії перелічено за ID поруч із чинною.',
    banner: '> ЗАБЛОКОВАНО — це чернетка discovery, а не затверджений вхід для Spec Kit.',
    intent: 'Намір', scope: 'Межі', constraints: 'Обмеження', facts: 'Факти', tree: 'Питання й рішення', assumptions: 'Припущення', retained: 'Поза чинним станом, але на них посилаються', open: 'Відкриті питання',
    decision: 'Рішення', review: 'Огляд', reaffirmed: 'Підтверджено оглядом', chosen: 'Обрано', options: 'Варіанти на розгляді', arguments: 'Аргументи', answer: 'Відповідь', notChosen: 'Не обрано',
    rationale: 'Обґрунтування', basedOn: 'Спирається на', dependsOn: 'Залежить від', initialBasis: 'Початкова підстава (чинну дає останній огляд)', initialDependsOn: 'Початкові залежності',
    resolves: 'Вирішує також', selected: 'Обрано', alternatives: 'Альтернативи', related: 'Повʼязані', sources: 'Джерела', challengedBy: 'Оскаржено', consequences: 'Наслідки',
    derivesFrom: 'Походить від', issueRef: 'Питання', parent: 'Батьківське питання', supersededBy: 'Замінено на', referencedBy: 'Посилаються',
    supports: 'Підтримує', attacks: 'Заперечує', undercuts: 'Підважує', supportedBy: 'За', attackedBy: 'Проти', undercutBy: 'Підважено', contradicts: 'Суперечить',
    version: 'Попередні версії', resolution: 'Попередні розвʼязання', reviewHistory: 'Попередні огляди', consequenceHistory: 'Колишні наслідки',
    validation: 'Перевірка', nonblockingReason: 'Не блокує', deferReason: 'Відкладено', branch: 'Гілка', dropped: 'знято', resolvedBy: 'рішення', answeredBy: 'відповідь', see: 'див.', under: 'підпитання',
    summarizedIn: 'Підсумовано в', unconcluded: 'Висновок ще не записано', blocking: 'блокує', nonblocking: 'не блокує', basis: 'підстава', quote: ['«', '»'],
    basisKinds: { user: 'намір користувача', authority: 'нормативне джерело' },
    hints: { existing: 'наявне', target: 'цільове', change: 'зміна', invariant: 'інваріант', edge: 'межовий випадок', scope: 'межі' },
    sourceKinds: { code: 'код', spec: 'специфікація', doc: 'документація', research: 'дослідження', user: 'користувач' },
    authorities: { normative: 'нормативне', observed: 'спостережене', reference: 'довідкове', intent: 'намір' },
    status: STATUS_UK, sourceFields: { revision: 'ревізія', accessed: 'переглянуто', symbols: 'символи', sha256: 'sha256' },
  },
};
const labelsFor = language => LABELS[language.split('-')[0].toLowerCase()];
export const blockedBanner = language => `${labelsFor(language).banner}\n\n`;

function render(graph, ix, settled, conclusions, language) {
  const L = labelsFor(language), { nodes, meta } = graph, { cls, tree } = settled, emitted = new Set(), placed = new Set();
  const place = id => { if (placed.has(id)) throw new DiscoveryError('INTERNAL', `${id} would be rendered twice.`); placed.add(id); emitted.add(id); };
  const mark = list => { for (const id of list) emitted.add(id); return list; };
  const refs = list => ix.byOrder(list).map(id => `[${id}]`).join(', ');
  const status = n => L.status[n.kind]?.[st(n)] ?? st(n);
  const tags = n => n.tags.filter(t => !Object.hasOwn(KINDS, t)).map(t => inline(/^[a-zA-Z0-9-]+$/.test(t) ? `#${t}` : `#(${t})`));
  const meta_ = (n, extra = []) => `_(${[status(n), ...extra, L.hints[n.data.handoff], ...tags(n)].filter(Boolean).join(' · ')})_`;
  const scalar = v => typeof v === 'string' ? inline(v) : isObject(v) || Array.isArray(v) ? code(JSON.stringify(v)) : String(v);
  const isId = x => typeof x === 'string' && nodes.has(x);
  const kept = id => cls.shown(id) || cls.history.has(id);

  const history = new Map();
  for (const [id, { target, role }] of cls.history) { if (!history.has(target)) history.set(target, {}); (history.get(target)[role] ??= []).push(id); }
  const chain = (target, list) => {
    const distance = h => { let steps = 0; for (let c = nodes.get(h); c && c.id !== target && steps <= nodes.size; c = nodes.get(c.data.superseded_by)) steps++; return steps; };
    const sorted = ix.byOrder(list).sort((a, b) => distance(b) - distance(a));
    return sorted.map(h => `[${h}]`).join(sorted.every((h, i) => !i || distance(sorted[i - 1]) === distance(h) + 1) ? ' → ' : ', ');
  };
  const historyLines = (id, pad) => {
    const h = history.get(id) ?? {};
    return [['version', L.version, list => chain(id, list)], ['resolution', L.resolution, refs], ['review', L.reviewHistory, refs], ['consequence', L.consequenceHistory, refs]]
      .filter(([role]) => h[role]?.length).map(([role, label, format]) => `${pad}- ${label}: ${format(mark(h[role]))}`);
  };
  const relationLines = (n, pad) => {
    const out = ix.out(n.id), into = ix.into(n.id), lines = [];
    const add = (label, list) => { const shown = list.filter(kept); if (shown.length) lines.push(`${pad}- ${label}: ${refs(shown)}`); };
    for (const [type, label] of [['support', L.supports], ['attack', L.attacks], ['undercut', L.undercuts]]) add(label, out.filter(r => r.type === type).map(r => r.to));
    for (const [type, label] of [['support', L.supportedBy], ['attack', L.attackedBy], ['undercut', L.undercutBy]]) add(label, into.filter(r => r.type === type).map(r => r.from));
    add(L.contradicts, [...out, ...into].filter(r => r.type === 'contradictory').map(r => r.from === n.id ? r.to : r.from));
    return lines;
  };
  const source = s => {
    const ref = s.kind === 'user' ? `${L.quote[0]}${inline(s.ref)}${L.quote[1]}` : /^https?:\/\/[^\s<>]+$/i.test(s.ref) ? `<${s.ref}>` : code(s.ref);
    const rest = [...(s.locator !== undefined ? [scalar(s.locator)] : []), ...Object.entries(s).filter(([k]) => !['kind', 'ref', 'authority', 'locator'].includes(k))
      .map(([k, v]) => `${L.sourceFields[k] ?? inline(k)}: ${k === 'sha256' ? code(v) : scalar(Array.isArray(v) ? v.join(', ') : v)}`)];
    return `${L.sourceKinds[s.kind] ?? inline(s.kind)}, ${L.authorities[s.authority] ?? inline(s.authority)}: ${ref}${rest.length ? ` (${rest.join('; ')})` : ''}`;
  };
  const extra = (key, value, pad) => {
    const label = `${pad}- ${inline(key.replaceAll('_', ' '))}:`;
    if (Array.isArray(value) && value.length && value.every(isId)) return [`${label} ${refs(value)}`];
    if (isObject(value) && Object.keys(value).length && Object.keys(value).every(isId)) {
      // Notes about nodes that were not chosen belong to their branch conclusions; the IDs remain.
      if (Object.keys(value).every(id => cls.pruned.has(id))) return [`${label} ${refs(Object.keys(value))}`];
      return [label, ...ix.byOrder(Object.keys(value)).map(id => `${pad}  - [${id}]: ${scalar(value[id])}`)];
    }
    if (Array.isArray(value)) return [label, ...value.map(x => `${pad}  - ${typeof x === 'string' ? blockText(x) : scalar(x)}`)];
    if (isObject(value)) return [label, ...Object.entries(value).map(([k, x]) => `${pad}  - ${inline(k)}: ${scalar(x)}`)];
    return [`${label} ${scalar(value)}`];
  };
  // Lines for every field the kind-specific renderer did not consume; nothing recorded is dropped.
  const fieldLines = (n, pad, used) => {
    const d = n.data, lines = [], line = (key, label, value) => { if (used.has(key)) return; used.add(key); if (value) lines.push(`${pad}- ${label}: ${value}`); };
    for (const key of ['status', 'handoff', 'supersedes']) used.add(key);
    const initial = cls.reaffirmedBy.has(n.id);
    if (initial) mark([...ids(d.based_on), ...ids(d.depends_on)].filter(b => cls.history.get(b)?.target === n.id));
    line('based_on', initial ? L.initialBasis : L.basedOn, ids(d.based_on).length ? refs(d.based_on) : '');
    line('depends_on', initial ? L.initialDependsOn : L.dependsOn, ids(d.depends_on).length ? refs(d.depends_on) : '');
    line('derives_from', L.derivesFrom, isId(d.derives_from) ? `[${d.derives_from}]` : '');
    line('issue', L.issueRef, isId(d.issue) ? `[${d.issue}]` : '');
    line('parent', L.parent, isId(d.parent) ? `[${d.parent}]` : '');
    line('related', L.related, ids(d.related).length ? refs(d.related) : '');
    lines.push(...relationLines(n, pad));
    line('challenged_by', L.challengedBy, ids(d.challenged_by).length ? refs(d.challenged_by) : '');
    line('validation', L.validation, d.validation !== undefined ? scalar(d.validation) : '');
    if (d.blocking === false) { used.add('blocking'); line('nonblocking_reason', L.nonblockingReason, d.nonblocking_reason !== undefined ? scalar(d.nonblocking_reason) : ''); }
    line('defer_reason', L.deferReason, d.defer_reason !== undefined ? scalar(d.defer_reason) : '');
    line('superseded_by', L.supersededBy, isId(d.superseded_by) ? `[${d.superseded_by}]` : '');
    line('sources', L.sources, Array.isArray(d.sources) && d.sources.length ? d.sources.map(source).join('; ') : '');
    lines.push(...historyLines(n.id, pad));
    for (const [key, value] of Object.entries(d)) if (!used.has(key)) lines.push(...extra(key, value, pad));
    return lines;
  };
  const item = (n, pad = '', used = new Set()) => {
    place(n.id);
    const head = [];
    if (n.kind === 'assumption' && st(n) === 'unverified') { used.add('blocking'); head.push(n.data.blocking === false ? L.nonblocking : L.blocking); }
    return [`${pad}- **[${n.id}]** ${inline(n.text)} ${meta_(n, head)}`, ...fieldLines(n, `${pad}  `, used)];
  };
  const homes = new Map();
  for (const id of cls.current) {
    const n = nodes.get(id);
    if (n.kind !== 'decision') continue;
    const issues = ids(n.data.resolves), inTree = issues.filter(i => tree.position.has(i)).sort((a, b) => tree.position.get(a) - tree.position.get(b));
    homes.set(id, inTree[0] ?? tree.up(issues[0]));
  }
  for (const issue of tree.order) { const r = nodes.get(issue).data.resolved_by; if (cls.current.has(r) && nodes.get(r).kind !== 'decision' && !homes.has(r)) homes.set(r, issue); }
  const decisionBlock = n => {
    place(n.id);
    const d = n.data, used = new Set(['resolves', 'basis', 'rationale', 'reaffirmed_by', 'consequences', 'selected', 'alternatives', 'based_on', 'depends_on']), lines = [];
    const header = [status(n), d.basis ? `${L.basis}: ${L.basisKinds[d.basis] ?? inline(d.basis)}` : '', L.hints[d.handoff], ...tags(n)].filter(Boolean).join(' · ');
    const line = (label, value) => { if (value) lines.push(`- ${label}: ${value}`); }, initial = cls.reaffirmedBy.has(n.id);
    line(L.rationale, d.rationale !== undefined ? scalar(d.rationale) : '');
    if (initial) mark([...ids(d.based_on), ...ids(d.depends_on)].filter(b => cls.history.get(b)?.target === n.id));
    line(initial ? L.initialBasis : L.basedOn, ids(d.based_on).length ? refs(d.based_on) : '');
    line(initial ? L.initialDependsOn : L.dependsOn, ids(d.depends_on).length ? refs(d.depends_on) : '');
    line(L.resolves, refs(ids(d.resolves).filter(id => id !== homes.get(n.id))));
    // Chosen options appear under their own questions; a decision outside the current state lists them here.
    if (!cls.current.has(n.id)) line(L.selected, refs(ids(d.selected)));
    line(L.alternatives, refs(ids(d.alternatives)));
    const chainOrder = ids(d.reaffirmed_by);
    for (const id of ix.byOrder(ix.reviews(n.id).filter(v => cls.shown(v) && !placed.has(v))).sort((a, b) => chainOrder.indexOf(a) - chainOrder.indexOf(b))) {
      const v = nodes.get(id); place(id);
      lines.push(`- ${chainOrder.includes(id) ? L.reaffirmed : L.review} **[${id}]** ${meta_(v)}: ${inline(v.text)}`,
        ...(v.data.rationale !== undefined ? [`  - ${L.rationale}: ${scalar(v.data.rationale)}`] : []), ...fieldLines(v, '  ', new Set(['decision', 'rationale'])));
    }
    const effects = ix.effects(n.id).filter(c => cls.shown(c) && !placed.has(c)), notes = d.consequences === undefined ? [] : Array.isArray(d.consequences) ? d.consequences : [d.consequences];
    if (effects.length || notes.length) lines.push(`- ${L.consequences}:`, ...effects.flatMap(c => item(nodes.get(c), '  ', new Set(['derives_from']))),
      ...notes.map(x => `  - ${typeof x === 'string' ? blockText(x) : scalar(x)}`));
    lines.push(...fieldLines(n, '', used));
    return [`**${L.decision} [${n.id}]** _(${header})_`, `> ${blockText(n.text)}`, ...(lines.length ? [lines.join('\n')] : [])];
  };
  const group = (title, lines) => lines.length ? [`**${title}**`, lines.join('\n')] : [];
  const notChosen = id => {
    const lines = [];
    conclusions.forEach((c, i) => {
      if (c.issue !== id) return;
      const covered = [...settled.coveredBy].filter(([, index]) => index === i).map(([node]) => node);
      lines.push(`- ${blockText(c.text)}`, `  - ${L.branch}: ${refs(mark(covered))}`);
    });
    for (const d of ix.byOrder([...settled.selfConcluded.keys()].filter(d => tree.up(d) === id))) {
      const issue = nodes.get(d), branch = settled.selfConcluded.get(d);
      mark([d]);
      lines.push(`- **[${d}]** ${inline(issue.text)} ${meta_(issue)} — ${L.dropped}: ${issue.data.reason !== undefined ? scalar(issue.data.reason) : ''}`, ...(branch.length ? [`  - ${L.branch}: ${refs(mark(branch))}`] : []));
    }
    const pointers = new Map();
    for (const [node, index] of settled.coveredBy) {
      const target = conclusions[index].issue;
      if (target !== id && settled.anchor(node) === id) { if (!pointers.has(target)) pointers.set(target, []); pointers.get(target).push(node); }
    }
    for (const [target, list] of pointers) lines.push(`- ${L.summarizedIn} [${target}]: ${refs(list)}`);
    const missing = settled.uncovered.filter(node => settled.anchor(node) === id);
    if (missing.length) lines.push(`- ⚠ ${L.unconcluded}: ${refs(mark(missing))}`);
    return group(L.notChosen, lines);
  };
  const issueBlock = id => {
    const n = nodes.get(id), d = n.data, level = 3 + tree.depth.get(id), resolver = nodes.get(d.resolved_by);
    place(id);
    const state = [status(n)];
    if (st(n) === 'resolved' && resolver) state.push(`${resolver.kind === 'decision' ? L.resolvedBy : L.answeredBy} [${resolver.id}]${homes.get(resolver.id) && homes.get(resolver.id) !== id ? ` (${L.see} [${homes.get(resolver.id)}])` : ''}`);
    if (lifecycle(n) === 'unsettled' && id !== meta.root) state.push(d.blocking === false ? L.nonblocking : L.blocking);
    if (level > 6) state.push(`${L.under} [${tree.up(id)}]`);
    if (L.hints[d.handoff]) state.push(L.hints[d.handoff]);
    state.push(...tags(n));
    const own = fieldLines(n, '', new Set(['parent', 'resolved_by', 'resolution_history']));
    const attached = kind => ix.attached(id).map(x => nodes.get(x)).filter(x => x.kind === kind && cls.current.has(x.id) && !placed.has(x.id));
    const decisions = ix.byOrder([...homes].filter(([r, home]) => home === id && nodes.get(r).kind === 'decision').map(([r]) => r)).map(r => nodes.get(r));
    const answers = ix.byOrder([...homes].filter(([r, home]) => home === id && nodes.get(r).kind !== 'decision').map(([r]) => r)).map(r => nodes.get(r));
    const strays = [...cls.current].filter(a => nodes.get(a).kind === 'argument' && !tree.position.has(nodes.get(a).data.issue) && tree.up(nodes.get(a).data.issue) === id).map(a => nodes.get(a));
    return [`${'#'.repeat(Math.min(level, 6))} [${id}] ${headingText(n.text)}`, `_${state.join(' · ')}_`, ...(own.length ? [own.join('\n')] : []),
      ...decisions.flatMap(decisionBlock), ...group(L.answer, answers.flatMap(x => item(x, '', new Set(['issue'])))),
      ...group(L.chosen, attached('position').filter(x => st(x) === 'accepted').flatMap(x => item(x, '', new Set(['issue'])))),
      ...group(L.options, attached('position').filter(x => st(x) !== 'accepted').flatMap(x => item(x, '', new Set(['issue'])))),
      ...group(L.arguments, [...attached('argument'), ...strays].flatMap(x => item(x, '', new Set(x.data.issue === id ? ['issue'] : [])))), ...notChosen(id)];
  };
  const section = (title, blocks) => blocks.length ? [`## ${title}`, ...blocks] : [];
  const listOf = list => list.length ? [list.join('\n')] : [];
  const treeBlocks = tree.order.flatMap(issueBlock);
  const rest = kind => [...cls.current].filter(id => nodes.get(id).kind === kind && !placed.has(id)).map(id => nodes.get(id));
  const constraints = rest('constraint').flatMap(n => item(n)), facts = rest('evidence').flatMap(n => item(n)), assumptions = rest('assumption').flatMap(n => item(n));
  // Retired decisions first, so their current consequences stay inside their blocks.
  const retained = ix.byOrder([...cls.retained]).sort((a, b) => (nodes.get(b).kind === 'decision') - (nodes.get(a).kind === 'decision')).flatMap(id => {
    if (placed.has(id)) return [];
    const n = nodes.get(id), by = `- ${L.referencedBy}: ${refs(ix.requirers(id).filter(cls.shown))}`;
    return n.kind === 'decision' ? [...decisionBlock(n), by] : [[...item(n), `  ${by}`].join('\n')];
  });
  const unplaced = [...cls.current, ...cls.retained].filter(id => !placed.has(id));
  if (unplaced.length) throw new DiscoveryError('INTERNAL', 'The renderer has no place for current nodes.', ix.byOrder(unplaced));
  const open = tree.order.filter(id => id !== meta.root && lifecycle(nodes.get(id)) === 'unsettled').map(id => `- [${id}] _${status(nodes.get(id))} · ${nodes.get(id).data.blocking === false ? L.nonblocking : L.blocking}_`);
  const body = [`# ${headingText(meta.title)}`, `> ${L.legend}`, ...section(L.intent, [blockText(meta.intent)]), ...section(L.scope, listOf(ids(meta.scope).map(s => `- ${blockText(s)}`))),
    ...section(L.constraints, listOf(constraints)), ...section(L.facts, listOf(facts)), ...section(L.tree, treeBlocks), ...section(L.assumptions, listOf(assumptions)),
    ...section(L.retained, retained), ...section(L.open, listOf(open))].join('\n\n') + '\n';
  return { body, emitted };
}

// Renders the handoff Markdown. Strict drafts are publishable: every branch that was not
// chosen has a conclusion. Non-strict drafts mark the missing conclusions instead.
export function draftHandoff(graph, input, { strict = true } = {}) {
  const { language, conclusions } = handoffInput(input), ix = indexGraph(graph), projection = projectGraph(graph), required = new Set(projection.required_coverage);
  const settled = settle(graph, ix, required, conclusions), unconcluded = groups(graph, ix, settled, settled.uncovered);
  if (strict && unconcluded.length) throw new DiscoveryError('COVERAGE', 'Every branch that was not chosen needs a short conclusion. Supply conclusions for these nodes, grouped by the issue they belong to.', unconcluded);
  const { body, emitted } = render(graph, ix, settled, conclusions, language);
  const missing = [...graph.nodes.keys()].filter(id => !emitted.has(id));
  if (missing.length) throw new DiscoveryError('INTERNAL', 'The rendered handoff omits graph nodes.', missing);
  // The review accounts for the sources of every node shown with its text, and of every node the projection relies on.
  const shown = [...settled.cls.current, ...settled.cls.retained].filter(id => !settled.folded.has(id));
  const sources = [...new Map([...projection.sources, ...shown.flatMap(id => ids(graph.nodes.get(id).data.sources))].map(s => [canonical(s), s])).values()];
  return { body, language, conclusions, renderer: RENDERER, uncovered: unconcluded, fold_candidates: foldCandidates(graph, ix, required, settled), sources };
}
