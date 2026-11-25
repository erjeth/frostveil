import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../src/core/index.js';

const FUNCTIONS = [
  'mulberry32', 'bfsLayers', 'connectedComponents', 'articulationPointsAndBridges',
  'createGameState', 'applyAction', 'undoAction', 'endWardenPhase', 'isContained', 'blockedMask',
  'frostForecast', 'safeZones', 'evaluateOutcome', 'generateLevel', 'buildLevel',
  'randomStrategy', 'maxDegreeStrategy', 'articulationGreedyStrategy', 'playOut', 'bruteForceOptimal',
];

test('contract: every named export exists with the right type', () => {
  for (const name of FUNCTIONS) assert.equal(typeof core[name], 'function', `${name} must be a function`);
  assert.equal(typeof core.Graph, 'function', 'Graph must be a class');
  assert.match(Function.prototype.toString.call(core.Graph), /^class\b/);
  assert.equal(typeof core.NodeState, 'object');
  assert.ok(Array.isArray(core.LEVEL_SPECS));
  assert.ok(Array.isArray(core.STRATEGIES));
});

test('contract: no unexpected public exports (internals stay internal)', () => {
  const expected = new Set([...FUNCTIONS, 'Graph', 'NodeState', 'LEVEL_SPECS', 'STRATEGIES']);
  for (const name of Object.keys(core)) assert.ok(expected.has(name), `unexpected export: ${name}`);
  for (const name of expected) assert.ok(name in core, `missing export: ${name}`);
});

test('contract: Graph has the documented API', () => {
  const g = new core.Graph(3);
  for (const m of ['addEdge', 'removeEdge', 'hasEdge', 'neighbors', 'degree', 'edges', 'clone']) {
    assert.equal(typeof g[m], 'function', `Graph.${m}`);
  }
  assert.equal(g.n, 3);
  assert.equal(g.m, 0);
  assert.equal(typeof Object.getOwnPropertyDescriptor(core.Graph.prototype, 'n').get, 'function', 'n is a getter');
  assert.equal(typeof Object.getOwnPropertyDescriptor(core.Graph.prototype, 'm').get, 'function', 'm is a getter');
});

test('contract: return shapes of the graph algorithms', () => {
  const g = new core.Graph(4);
  g.addEdge(0, 1); g.addEdge(1, 2);
  const b = core.bfsLayers(g, [0]);
  assert.ok(b.dist instanceof Int32Array && b.order instanceof Int32Array && Array.isArray(b.layers));
  const c = core.connectedComponents(g);
  assert.ok(c.compId instanceof Int32Array && Number.isInteger(c.count) && Array.isArray(c.sizes));
  const t = core.articulationPointsAndBridges(g);
  assert.ok(t.points instanceof Set && Array.isArray(t.bridges));
});

test('contract: return shapes of simulation, levels and strategies', () => {
  const level = core.buildLevel(1);
  assert.deepEqual(Object.keys(level).sort(), ['graph', 'k', 'n', 'nodes', 'seed', 'sources', 'targetPercent', 'totalPopulation']);
  assert.deepEqual(Object.keys(level.nodes[0]).sort(), ['id', 'isCitadel', 'population', 'x', 'y']);
  const s = core.createGameState(level);
  assert.deepEqual(Object.keys(s).sort(), ['actions', 'actionsLeft', 'graph', 'level', 'log', 'nodeState', 'outcome', 'over', 'turn']);
  assert.ok(s.nodeState instanceof Uint8Array);
  assert.ok(core.blockedMask(s) instanceof Uint8Array);
  assert.ok(core.frostForecast(s) instanceof Int32Array);
  const zones = core.safeZones(s);
  assert.deepEqual(Object.keys(zones[0]).sort(), ['nodes', 'population', 'threatened']);
  const r = core.endWardenPhase(s);
  assert.deepEqual(Object.keys(r).sort(), ['contained', 'newlyFrosted']);
  assert.deepEqual(Object.keys(core.evaluateOutcome(s)).sort(),
    ['citadelSafe', 'reference', 'savedPercent', 'savedPopulation', 'stars', 'totalPopulation', 'won']);
  const spec = core.LEVEL_SPECS[0];
  assert.deepEqual(Object.keys(spec).sort(), ['avgDegree', 'id', 'k', 'n', 'name', 'seed', 'sources', 'targetPercent']);
  const po = core.playOut(level, core.maxDegreeStrategy);
  assert.deepEqual(Object.keys(po).sort(), ['outcome', 'turns']);
  const bf = core.bruteForceOptimal(level);
  assert.deepEqual(Object.keys(bf).sort(), ['elapsedMs', 'outcome', 'truncated', 'turns']);
  for (const st of core.STRATEGIES) assert.deepEqual(Object.keys(st).sort(), ['fn', 'id', 'label']);
});

test('purity: src/core never touches the DOM, never imports outside src/core, has no dependencies', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 10);
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/\b(window|document|localStorage|HTMLCanvasElement|requestAnimationFrame)\b/.test(code), `${f}: browser global`);
    assert.ok(!/\brequire\s*\(/.test(code), `${f}: require`);
    for (const m of code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      assert.match(m[1], /^\.\/[A-Za-z]+\.js$/, `${f}: import "${m[1]}" must be a sibling ./module.js (no node:, no ../, no packages)`);
    }
  }
});

test('purity: package.json is an ES-module project with the required scripts and no runtime dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.test, 'node --test');
  assert.equal(pkg.scripts.bench, 'node bench/run.js');
  assert.ok(pkg.scripts.serve);
  assert.equal(pkg.dependencies, undefined);
});
