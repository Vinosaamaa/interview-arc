---
type: solution
title: "Course Schedule"
date: 2026-07-22
status: published
---

# Course Schedule

## Problem Summary

There are `numCourses` courses numbered `0` through `numCourses - 1`. Each pair `[course, prerequisite]` creates the directed edge `prerequisite -> course`. Return whether every course can be completed. Equivalently, determine whether this directed graph is acyclic.

## Pattern Recognition and Constraints

The words **prerequisite**, **dependency**, and **can everything be completed** point to directed-graph cycle detection. Both Kahn’s topological sort and DFS three-state coloring run in `O(V + E)`. Kahn’s algorithm is the preferred interview answer because the number of processed vertices gives the boolean result directly and avoids recursion-depth concerns.

## Best Approach: Kahn’s BFS Topological Sort

1. Build an adjacency list from each prerequisite to the courses it unlocks.
2. Count every course’s indegree, which is its number of unmet prerequisites.
3. Queue all zero-indegree courses.
4. Repeatedly process a ready course and decrement its neighbors’ indegrees.
5. Queue each neighbor when its indegree reaches zero.
6. Return `true` exactly when the processed count equals `numCourses`.

## Correctness Proof

Every course entering the queue has no unmet prerequisite, so appending it to the order is valid. Processing it removes exactly the dependency edges it satisfies. Therefore, if all vertices are processed, their processing order is a valid topological order.

If some vertices remain, every vertex in the remaining finite subgraph has positive indegree. Following incoming edges must eventually revisit a vertex, which proves that the remaining subgraph contains a directed cycle. Those courses cannot all be completed. Therefore, the algorithm returns `true` exactly when all courses are completable.

## Reference Implementation — Java

```java
import java.util.*;

class Solution {
    public boolean canFinish(int numCourses, int[][] prerequisites) {
        List<List<Integer>> graph = new ArrayList<>();
        for (int course = 0; course < numCourses; course++) {
            graph.add(new ArrayList<>());
        }

        int[] indegree = new int[numCourses];
        for (int[] pair : prerequisites) {
            int course = pair[0];
            int prerequisite = pair[1];
            graph.get(prerequisite).add(course);
            indegree[course]++;
        }

        Deque<Integer> ready = new ArrayDeque<>();
        for (int course = 0; course < numCourses; course++) {
            if (indegree[course] == 0) ready.offer(course);
        }

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

        ready = deque(
            course for course in range(numCourses)
            if indegree[course] == 0
        )
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

- Time: `O(V + E)`, where `V = numCourses` and `E = prerequisites.length`.
- Space: `O(V + E)` for the graph, indegree array, and queue.

## Alternative: DFS Three-State Coloring

Track each course as `0 = unvisited`, `1 = visiting`, or `2 = finished`. Reaching a visiting course proves a back edge and therefore a directed cycle. This has the same asymptotic cost as Kahn’s algorithm, but recursive implementations may require care on very deep graphs.

## Alternative Implementation: DFS Three-State Coloring — Java

```java
import java.util.*;

class Solution {
    public boolean canFinish(int numCourses, int[][] prerequisites) {
        List<List<Integer>> graph = new ArrayList<>();
        for (int course = 0; course < numCourses; course++) {
            graph.add(new ArrayList<>());
        }
        for (int[] pair : prerequisites) {
            graph.get(pair[1]).add(pair[0]);
        }

        int[] state = new int[numCourses];
        for (int course = 0; course < numCourses; course++) {
            if (state[course] == 0 && hasCycle(course, graph, state)) {
                return false;
            }
        }
        return true;
    }

    private boolean hasCycle(
        int course,
        List<List<Integer>> graph,
        int[] state
    ) {
        state[course] = 1;
        for (int next : graph.get(course)) {
            if (state[next] == 1) return true;
            if (state[next] == 0 && hasCycle(next, graph, state)) return true;
        }
        state[course] = 2;
        return false;
    }
}
```

## Alternative Implementation: DFS Three-State Coloring — Python

```python
from typing import List

class Solution:
    def canFinish(self, numCourses: int, prerequisites: List[List[int]]) -> bool:
        graph = [[] for _ in range(numCourses)]
        for course, prerequisite in prerequisites:
            graph[prerequisite].append(course)

        state = [0] * numCourses

        def has_cycle(course: int) -> bool:
            state[course] = 1
            for next_course in graph[course]:
                if state[next_course] == 1:
                    return True
                if state[next_course] == 0 and has_cycle(next_course):
                    return True
            state[course] = 2
            return False

        return all(
            state[course] != 0 or not has_cycle(course)
            for course in range(numCourses)
        )
```

## Alternative: Strongly Connected Components

Tarjan’s algorithm identifies the exact cyclic groups rather than only returning a boolean. An SCC with more than one vertex is cyclic; a one-vertex SCC is cyclic only when the course has a self-loop. Prefer this approach when diagnostics must report which courses participate in each cycle.

## Alternative Implementation: Tarjan SCC — Java

```java
import java.util.*;

class Solution {
    private int time = 0;

    public boolean canFinish(int numCourses, int[][] prerequisites) {
        List<List<Integer>> graph = new ArrayList<>();
        for (int course = 0; course < numCourses; course++) {
            graph.add(new ArrayList<>());
        }
        boolean[] selfLoop = new boolean[numCourses];
        for (int[] pair : prerequisites) {
            graph.get(pair[1]).add(pair[0]);
            if (pair[0] == pair[1]) selfLoop[pair[0]] = true;
        }

        int[] discovery = new int[numCourses];
        int[] low = new int[numCourses];
        Arrays.fill(discovery, -1);
        boolean[] onStack = new boolean[numCourses];
        Deque<Integer> stack = new ArrayDeque<>();
        boolean[] cyclic = { false };

        for (int course = 0; course < numCourses; course++) {
            if (discovery[course] == -1) {
                tarjan(course, graph, discovery, low, onStack, stack, selfLoop, cyclic);
            }
        }
        return !cyclic[0];
    }

    private void tarjan(
        int node,
        List<List<Integer>> graph,
        int[] discovery,
        int[] low,
        boolean[] onStack,
        Deque<Integer> stack,
        boolean[] selfLoop,
        boolean[] cyclic
    ) {
        discovery[node] = low[node] = time++;
        stack.push(node);
        onStack[node] = true;

        for (int next : graph.get(node)) {
            if (discovery[next] == -1) {
                tarjan(next, graph, discovery, low, onStack, stack, selfLoop, cyclic);
                low[node] = Math.min(low[node], low[next]);
            } else if (onStack[next]) {
                low[node] = Math.min(low[node], discovery[next]);
            }
        }

        if (low[node] == discovery[node]) {
            int size = 0;
            int member;
            do {
                member = stack.pop();
                onStack[member] = false;
                size++;
            } while (member != node);
            if (size > 1 || selfLoop[node]) cyclic[0] = true;
        }
    }
}
```

## Alternative Implementation: Tarjan SCC — Python

```python
from typing import List

class Solution:
    def canFinish(self, numCourses: int, prerequisites: List[List[int]]) -> bool:
        graph = [[] for _ in range(numCourses)]
        self_loop = [False] * numCourses
        for course, prerequisite in prerequisites:
            graph[prerequisite].append(course)
            if course == prerequisite:
                self_loop[course] = True

        discovery = [-1] * numCourses
        low = [0] * numCourses
        on_stack = [False] * numCourses
        stack = []
        time = 0
        cyclic = False

        def tarjan(node: int) -> None:
            nonlocal time, cyclic
            discovery[node] = low[node] = time
            time += 1
            stack.append(node)
            on_stack[node] = True

            for next_course in graph[node]:
                if discovery[next_course] == -1:
                    tarjan(next_course)
                    low[node] = min(low[node], low[next_course])
                elif on_stack[next_course]:
                    low[node] = min(low[node], discovery[next_course])

            if low[node] == discovery[node]:
                size = 0
                while True:
                    member = stack.pop()
                    on_stack[member] = False
                    size += 1
                    if member == node:
                        break
                if size > 1 or self_loop[node]:
                    cyclic = True

        for course in range(numCourses):
            if discovery[course] == -1:
                tarjan(course)

        return not cyclic
```

## Edge Cases

- No prerequisites or one independent course.
- Disconnected components.
- Two-node and longer cycles.
- A self-dependency such as `[0, 0]`.
- Several prerequisites converging on one course.
- Duplicate prerequisite edges; they are counted and removed consistently.

## Common Mistakes

- Reversing the edge and incrementing the wrong course’s indegree.
- Returning `true` when the queue becomes empty instead of checking the processed count.
- Running cycle detection from only course `0` and missing disconnected components.
- Marking a DFS node finished before all of its descendants have finished.

## Recall Cue

“Can every dependency be satisfied?” means: build a directed graph and prove it is acyclic with topological sort or DFS coloring.

## Improved Interview Answer

I model `[a, b]` as the edge `b -> a`, because completing `b` unlocks `a`. Then I run Kahn’s topological sort: queue every zero-indegree course, process it, and decrement the indegrees of the courses it unlocks. If I process all `numCourses` vertices, the processing order is a valid topological order; otherwise the remaining subgraph contains a directed cycle. The algorithm uses `O(V + E)` time and `O(V + E)` space.
