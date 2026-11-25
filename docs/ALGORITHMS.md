# Frostveil: Algorithms (Member A)

All algorithms live in `src/core/`. Notation: V = nodes, E = edges, k = beacons per turn.
Every traversal is iterative (explicit stack or typed-array queue); nothing recurses over the graph.

## 1. BFS with layers (`bfs.js`)

**Used for:** one frost step (layer 1), the Frost Forecast (arrival times), and strategy scoring.

**Data structures:** `dist: Int32Array(V)` (-1 = unvisited), a preallocated `Int32Array(V)` queue with
`head`/`tail` indices (no `Array.shift`), optional `blocked: Uint8Array`.

```
bfsLayers(G, sources, blocked):
    dist[*] = -1; queue = []
    for s in sources: if dist[s] == -1: dist[s] = 0; push s          # sources visited even if blocked
    while queue not empty:                                           # one whole layer per outer pass
        for each u of the current layer:
            for v in G.neighbors(u):
                if dist[v] == -1 and not blocked[v]:
                    dist[v] = dist[u] + 1; push v
    return dist, visit order, layers grouped by dist
```

**Complexity:** time O(V + E), space O(V).
**Correctness (sketch):** by induction on d, when layer d is complete, it holds exactly the nodes whose
shortest path from the source set (through unblocked nodes) has length d: a node first discovered while
scanning layer d-1 cannot be closer, and every neighbour of layer d-1 not yet seen is at distance d.

## 2. Connected components by iterative DFS (`components.js`)

**Used for:** Safe Zones (components of CLEAR nodes; FROSTED/WARDED are walls).

**Data structures:** `compId: Int32Array(V)` doubling as the visited marker, an `Int32Array(V)` stack.
A node is marked when pushed, so it is on the stack at most once and the stack never exceeds V.

```
for root in 0..V-1:
    if compId[root] != -1 or blocked[root]: continue
    compId[root] = c; push root; size = 0
    while stack not empty:
        u = pop; size++
        for v in G.neighbors(u): if compId[v] == -1 and not blocked[v]: compId[v] = c; push v
    sizes[c++] = size
```

**Complexity:** O(V + E) time, O(V) space. Verified on a 100,000-node path (a recursive DFS overflows there).
**Correctness:** the inner loop is a graph search from `root` over unblocked nodes, so it labels exactly
root's component; the outer loop starts a new search for every unlabeled node, so each component gets one id.

## 3. Articulation points and bridges: iterative Tarjan (`tarjan.js`)

**Used for:** candidate selection of the greedy strategy / Hint; critical settlements and roads.

**Data structures:** `disc[v]` (discovery time), `low[v]`, `parent[v]`, `nextIdx[v]` (cursor into the neighbour
list, which replaces the recursion's saved loop position), an `Int32Array(V)` DFS stack. Blocked nodes are skipped
everywhere, i.e. treated as removed.

```
for root in unvisited, unblocked nodes:
    disc[root] = low[root] = t++; push root; rootChildren = 0
    while stack not empty:
        u = top
        if u has an unexamined neighbour v:
            if v blocked or v == parent[u]: continue
            if v unvisited: parent[v] = u; disc[v] = low[v] = t++; push v; if u == root: rootChildren++
            else:           low[u] = min(low[u], disc[v])               # back edge
        else:                                                             # "return from the recursive call"
            pop u; p = parent[u]
            if p exists:
                low[p] = min(low[p], low[u])
                if low[u] >  disc[p]:                    bridge (p, u)
                if low[u] >= disc[p] and p != root:      p is an articulation point
    if rootChildren >= 2: root is an articulation point
```

The graph is simple, so skipping the parent *node* equals skipping the parent *edge*.
**Complexity:** O(V + E) time, O(V) space. Tested on 200,000-node paths.
**Correctness (sketch):** `low[c] >= disc[p]` means no back edge from the subtree of child c climbs strictly above p,
so deleting p disconnects c's subtree from the rest, which makes p a cut vertex unless p is the root, where
the rest is empty and p is a cut vertex only with at least two DFS children (their subtrees are mutually
unconnected in a DFS tree of an undirected graph). `low[c] > disc[p]` additionally forbids a back edge to p itself,
so the tree edge (p, c) is the only connection: a bridge. The implementation is cross-checked against
"remove each node/edge and recount components" on 400 random graphs (with and without blocked masks).

## 4. Kruskal MST with union-find (level generator, `levelGen.js`)

**Used for:** guaranteeing a connected road network made of short roads.

**Data structures:** candidate edges (k-nearest-neighbour pairs, found with a uniform grid) as typed arrays sorted by
(length, u, v); union-find with path halving and union by size.

```
sort candidate edges by length
for each edge (u, v) in order:
    if find(u) != find(v): union(u, v); add (u, v) to the road network
if more than one set remains: double K (neighbours per point), regenerate candidates, repeat
```

**Complexity:** O(E log E) for the sort + O(E alpha(V)) for the unions. Candidate generation is about O(V K) expected
(grid ring search); the whole 50,000-node level is generated in under a second.
**Correctness:** the standard cut property: the shortest edge crossing any cut belongs to some MST, and scanning in
increasing order adds an edge exactly when it crosses the cut between its tree and the rest. Termination: K = V - 1
gives the complete graph, which is connected.

**Extra roads** (target average degree, default 3.2): the shortest remaining candidates that are *Gabriel* edges
(no other point inside the circle whose diameter is the segment). The Gabriel graph is planar and contains the Euclidean
MST, so these cannot cross the MST or each other. If Gabriel candidates run out (only for degrees above about 4), shorter
candidates are added only if an exact segment test finds no crossing (n <= 2000). Result on 400 generated levels: 0 crossings.

**Point placement:** Mitchell's best-candidate sampling (10 candidates per point, keep the one farthest from existing points),
grid-accelerated. **Sources/Citadel:** drawn from the farthest 35 % of nodes by hop distance, so levels are fair but
the Citadel is not always the farthest node.

## 5. Articulation-Aware Greedy (`strategies.js`)

**Used for:** the strongest built-in strategy, the in-game Hint, the "2 stars" reference.

```
greedy(state):                                            # never mutates state
    blocked = copy of FROSTED/WARDED mask; actions = []
    repeat state.actionsLeft times:
        base = BFS(frost sources, blocked).dist
        C = articulationPoints(G restricted to CLEAR nodes) U {CLEAR nodes adjacent to FROSTED}
            (all CLEAR nodes if C is empty); keep only v with base[v] >= 1 (frost can still reach v)
        for v in C:
            blocked[v] = 1;  lost = population of all nodes visited by BFS(frost sources, blocked);  blocked[v] = 0
            score[v] = totalPopulation - lost            # population saved if v is warded now
        pick v maximising score; ties: smaller base[v], then larger population, then smaller id
        blocked[v] = 1; actions.append(beacon v)
    return actions
```

**Complexity per turn:** O(k * |C| * (V + E)): one Tarjan and one BFS per candidate per action; |C| is the number of
candidates (articulation points + frost frontier). **Space:** O(V).
**Why it works / limits:** warding a node of the CLEAR subgraph's cut set walls off whole regions at once, which is the
structure that matters in the Firefighter Problem; scoring by "everything the frost can still reach is lost" is exact
for the current position *if no further beacons were placed*, so the strategy is optimal for a single remaining beacon
but not globally optimal: it cannot trade a small loss now for a large gain later. The Firefighter Problem is NP-hard,
and level 2 (n = 16, k = 1) shows the gap: greedy saves 29 of 81, the optimum 54.
**Correctness argument for the score:** after the beacon, the nodes still lost eventually are exactly the FROSTED nodes plus
those reachable from them through CLEAR nodes (frost never crosses WARDED nodes), which is what the BFS computes.

## 6. Brute-force optimum with pruning (`strategies.js`, n <= 20, bitmasks up to n = 30)

**State:** (F, R): F = FROSTED set, R = CLEAR nodes the frost can still reach through CLEAR nodes, both as 31-bit masks.
The future depends only on (F, R): CLEAR nodes outside R can never be frosted, so wards that no longer border R are
irrelevant, and different beacon histories collapse into one memo entry.

```
minLoss(F, R):                          # least additional frosted population
    if |R| <= k: return 0               # ward everything reachable
    if (F, R) in memo: return memo value
    for each k-subset C of R:           # exactly k beacons: fewer is never better
        newly = N(F) & (R \ C);  F' = F | newly;  R' = region of (R \ C \ newly) reachable from N(newly)
        lb(C) = pop(newly) + (sum of the (|layer'| - k) lightest nodes of the next frost layer)
    sort children by lb; best = infinity
    for children in order: if lb >= best: stop;  best = min(best, pop(newly) + minLoss(F', R'))
    memo[(F, R)] = best
```

**Pruning validity:** at most k nodes of the next layer can be protected per turn, so at least the lightest (|layer| - k)
are lost: lb never overestimates, and the sorted scan can stop at the first lb >= best.
**Seeding and time limit:** the incumbent is the best heuristic playout, so the result is never worse than a heuristic. If the
search runs past `timeLimitMs` the incumbent is returned with `truncated: true`.
**Complexity:** exponential in the worst case, about C(|R|, k)^(turns) states before memoization and pruning. Measured:
210 free-play-style levels (n = 20-24, k = 1-3, 1-3 sources): worst case 17 ms, none truncated.
**Verification:** equals an independent naive exhaustive solver on 60 tiny random levels and on campaign levels 1 and 2.

## Assumptions and decisions

See the *Decisions* section of `docs/CONTRACT.md` (changed seeds, stars tiers, reference caching, playOut references).
