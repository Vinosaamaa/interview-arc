---
type: solution
title: "Course Schedule"
date: 2026-07-22
status: published
---

# Course Schedule

## Problem Summary

There are `numCourses` courses numbered `0` through `numCourses - 1`. A pair `[course, prerequisite]` creates the directed edge `prerequisite -> course`. Return whether every course can be completed. This is a directed-cycle question.

## Pattern Recognition and Constraints

The words **prerequisite**, **dependency**, and **can everything be completed** point to directed-graph cycle detection. Use an `O(V + E)` traversal. Kahn's topological sort is preferred because its processed-node count gives the answer directly.

## Best Approach: Kahn's BFS Topological Sort

Build an adjacency list and indegree array. Queue every zero-indegree course. Process ready courses, delete their outgoing edges, and enqueue neighbors that become ready. Return `true` exactly when the processed count equals `numCourses`.

## Correctness Reasoning

Every queued course has no remaining prerequisite, so processing it is valid. If all vertices are processed, that order is a topological order. If vertices remain, the finite remaining subgraph has no zero-indegree vertex and therefore contains a cycle.

## Reference Implementation — Java

```java
import java.util.*;

class Solution {
    public boolean canFinish(int numCourses, int[][] prerequisites) {
        List<List<Integer>> graph = new ArrayList<>();
        for (int i = 0; i < numCourses; i++) graph.add(new ArrayList<>());
        int[] indegree = new int[numCourses];
        for (int[] pair : prerequisites) {
            graph.get(pair[1]).add(pair[0]);
            indegree[pair[0]]++;
        }
        Deque<Integer> ready = new ArrayDeque<>();
        for (int i = 0; i < numCourses; i++) if (indegree[i] == 0) ready.offer(i);
        int completed = 0;
        while (!ready.isEmpty()) {
            int prerequisite = ready.poll();
            completed++;
            for (int course : graph.get(prerequisite)) {
                if (--indegree[course] == 0) ready.offer(course);
            }
        }
        return completed == numCourses;
    }
}
```

## Reference Implementation — Python

```python
from collections import deque
from typing import List

class Solution:
    def canFinish(self, numCourses: int, prerequisites: List[List[int]]) -> bool:
        graph = [[] for _ in range(numCourses)]
        indegree = [0] * numCourses
        for course, prerequisite in prerequisites:
            graph[prerequisite].append(course)
            indegree[course] += 1
        ready = deque(i for i in range(numCourses) if indegree[i] == 0)
        completed = 0
        while ready:
            prerequisite = ready.popleft()
            completed += 1
            for course in graph[prerequisite]:
                indegree[course] -= 1
                if indegree[course] == 0:
                    ready.append(course)
        return completed == numCourses
```

## Complexity

- Time: `O(V + E)`.
- Space: `O(V + E)`.

## Alternative: DFS Three-State Coloring

Use `0 = unvisited`, `1 = visiting`, and `2 = finished`. Reaching a visiting node is a back edge and proves a cycle.

```java
private boolean hasCycle(int node, List<List<Integer>> graph, int[] state) {
    state[node] = 1;
    for (int next : graph.get(node)) {
        if (state[next] == 1) return true;
        if (state[next] == 0 && hasCycle(next, graph, state)) return true;
    }
    state[node] = 2;
    return false;
}
```

## Meaningful Alternative: Strongly Connected Components

Tarjan's or Kosaraju's algorithm identifies the exact cyclic components in `O(V + E)`. Use it when the caller needs diagnostics about which courses form each cycle, not merely a boolean.

## Edge Cases

- No prerequisites or one independent course.
- Disconnected components.
- Two-node and longer cycles.
- A self-dependency.
- Several prerequisites converging on one course.

## Recall Cue

“Can every dependency be satisfied?” means: build a directed graph and prove it is acyclic with topological sort or DFS coloring.

## Improved Interview Answer

I model `[a, b]` as `b -> a`, then run Kahn's topological sort. I queue zero-indegree courses, process them, and decrement the indegrees of the courses they unlock. Processing every course proves the graph is acyclic; otherwise the remaining vertices contain a cycle. Time and space are both `O(V + E)`.

