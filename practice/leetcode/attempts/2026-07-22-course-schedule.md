---
type: leetcode
title: "Course Schedule"
date: 2026-07-22
activity_id: 2026-07-21-session-1-0-0-course-schedule
status: published
---

# Course Schedule

## Pinned Notes

None recorded.

## Problem Reference

Course Schedule

[Open the canonical question](https://leetcode.com/problems/course-schedule/)

## Timeline and Attempt Facts

- Session: `2026-07-21-session-1-0-0`
- Started: Jul 21, 2026, 11:54:08 PM PDT
- Finished: Jul 22, 2026, 2:57:06 AM PDT
- Elapsed: 1171 seconds
- Allocated: 2400 seconds
- Outcome: `solved`
- Timing source: `website`
- Transcript scope: `activity_exchanges`

## Summary

The website records a completed solved attempt in 1,171 seconds. Four Voice-managed user turns and one specialist reset question were preserved, but no user code, algorithm, or problem-specific explanation was observed. The standalone generated solution uses Kahn's topological sort to detect a directed cycle.

## Activity Exchanges

### User · Jul 22, 2026, 12:47:46 AM PDT

Okay, right now I'm using the activity button. So this is should be according to this one button, right? So we'll be able to finish all the things in this one button.

_Source: Voice transcript_

### User · Jul 22, 2026, 12:49:17 AM PDT

What the hell is going on? I didn't see any transcripts being transferred, being transcripted. I, what the fuck is this, bro?

_Source: Voice transcript_

### User · Jul 22, 2026, 12:50:39 AM PDT

Okay, let me understand this correctly. So, it's using so much, it takes so long, such a long time to transcribe what I'm saying, then they're a little bit crazy. What the fuck is this shit, bruh?

_Source: Voice transcript_

### User · Jul 22, 2026, 12:55:16 AM PDT

Thank you for watching!

_Source: Voice transcript_

### Specialist · Jul 22, 2026, 12:55:42 AM PDT

Let’s reset with one concrete question: for prerequisites[i] = [a, b], what does the directed edge represent, and what condition would make it impossible to complete all courses?

_Source: Codex_

## Generated Reference Solution

Generated original coaching solution — not an official LeetCode editorial.

## Problem summary

There are `numCourses` courses labeled from `0` to `numCourses - 1`. Each pair `[a, b]` means course `b` must be completed before course `a`. Return whether all courses can be completed.

This is a directed-graph cycle-detection problem. Model each prerequisite as an edge `b -> a`. All courses can be completed exactly when the graph has no directed cycle.

## Best approach: Kahn's algorithm (BFS topological sort)

1. Build an adjacency list from each prerequisite to the courses it unlocks.
2. Count the indegree of every course: the number of unmet prerequisites.
3. Put every zero-indegree course into a queue.
4. Repeatedly remove a ready course, count it as completed, and delete its outgoing edges by decrementing its neighbors' indegrees.
5. When a neighbor reaches indegree zero, add it to the queue.
6. Return `true` iff the number processed equals `numCourses`.

## Correctness reasoning

Every course placed in the queue has zero remaining prerequisites, so processing it is valid. Removing that course's outgoing edges correctly represents satisfying it as a prerequisite for its dependent courses. Therefore every processed course can appear in a valid course order.

If all courses are processed, the processing order is a topological ordering, so every prerequisite can be satisfied and all courses are completable.

If fewer than `numCourses` courses are processed, the remaining subgraph has no zero-indegree node. A finite directed graph in which every remaining node has an incoming edge contains a directed cycle. Those courses depend on one another cyclically, so completing all courses is impossible.

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
            graph.get(pair[1]).add(pair[0]);
            indegree[pair[0]]++;
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
- Space: `O(V + E)` for the adjacency list, indegree array, and queue.

## Edge cases

- No prerequisite pairs: every course is initially ready, so return `true`.
- One course with no prerequisites: return `true`.
- Disconnected prerequisite components: process all zero-indegree components independently.
- A two-course or longer directed cycle: the cycle never reaches indegree zero, so return `false`.
- A self-dependency such as `[0, 0]`: it is a cycle, so return `false`.
- Several prerequisites converging on one course: enqueue that course only after all incoming edges are removed.

## Alternative: DFS Three-State Coloring

Mark each node as unvisited, visiting, or finished. Reaching a visiting node reveals a back edge and therefore a cycle. This is also `O(V + E)` time and `O(V + E)` space including graph storage and the recursion stack.

## Alternative Implementation: DFS Three-State Coloring — Java

```java
import java.util.*;

class Solution {
    public boolean canFinish(int numCourses, int[][] prerequisites) {
        List<List<Integer>> graph = new ArrayList<>();
        for (int course = 0; course < numCourses; course++) {
            graph.add(new ArrayList<>());
        }
        for (int[] pair : prerequisites) graph.get(pair[1]).add(pair[0]);

        int[] state = new int[numCourses];
        for (int course = 0; course < numCourses; course++) {
            if (state[course] == 0 && hasCycle(course, graph, state)) return false;
        }
        return true;
    }

    private boolean hasCycle(int course, List<List<Integer>> graph, int[] state) {
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

Tarjan's or Kosaraju's algorithm can identify the exact cyclic components in `O(V + E)`. An SCC with multiple vertices, or one vertex with a self-loop, proves the schedule is impossible. The reusable solution includes complete Java and Python Tarjan implementations for diagnostic use.

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

## Recall cue

“Can every dependency be satisfied?” usually means: build a directed graph, then test for a cycle with topological sort or DFS coloring.

## Improved Interview Answer

I would model courses as vertices in a directed graph. For each pair `[a, b]`, I add the edge `b -> a` because completing `b` unlocks `a`. Then I run Kahn's topological-sort algorithm: enqueue every course with indegree zero, process it, and decrement the indegrees of the courses it unlocks. If I process all `numCourses` courses, the prerequisite graph is acyclic and the answer is true; otherwise the unprocessed courses contain a cycle and the answer is false. This takes `O(V + E)` time and `O(V + E)` space.

## What Went Well

- The website records the attempt outcome as solved; this is preserved without inventing the user's implementation or reasoning.
- Across the available Voice delivery analyses, the user's overall pace was generally moderate and listener-friendly, roughly 119–136 words per minute on the longer clips.
- Several recordings were direct and contained few conventional fillers; the shortest closing clip was fully intelligible and filler-free.
- The user clearly surfaced the transcript-capture problem instead of allowing missing evidence to be mistaken for a technical answer.

## What To Improve

- No Course Schedule approach, code, correctness argument, or complexity analysis was captured, so none can be credited to the user; next time, state the graph model, cycle-detection method, complexity, and conclusion explicitly.
- Use precise nouns and a compact structure—graph model, algorithm, correctness condition, complexity—rather than vague referents such as “it,” “they,” or “all the things.”
- The delivery analyses observed restarts, repeated transitions, and one rapidly delivered closing question; use deliberate sentence boundaries and keep the conclusion at the same steady pace.
- Keep interview delivery neutral and actionable when tooling fails: state the observed issue, expected behavior, and one concrete request, then return to the technical explanation.
- End the recording promptly after the answer; one clip contained about 2.6 seconds of trailing silence.

## Review Plan

No review was scheduled.

## Delivery Recordings

The original audio remains private in Cloudflare R2 and is playable only through Interview Arc's authenticated route.

1. **Recorded answer** — 17 seconds; available; linked to its user transcript turn. Private filename: `2026-07-22T07-50-21Z-2026-07-21-session-1-0-0-course-schedule-c4fe3989-ecf7-42cb-bfde-ede36bd24b94.m4a`.
2. **Recorded answer** — 14 seconds; available; linked to its user transcript turn. Private filename: `2026-07-22T07-47-31Z-2026-07-21-session-1-0-0-course-schedule-a22223dc-15b4-4ac9-9ba6-b61bb79add8e.m4a`.
3. **Recorded answer** — 11 seconds; available; linked to its user transcript turn. Private filename: `2026-07-22T07-49-05Z-2026-07-21-session-1-0-0-course-schedule-3681f1b8-f5e4-402e-a127-c7e751f401c9.m4a`.
4. **Recorded answer** — 5 seconds; available; linked to its user transcript turn. Private filename: `2026-07-22T07-55-10Z-2026-07-21-session-1-0-0-course-schedule-9a61f968-0d45-4a44-97fc-43e55772a993.m4a`.

## Delivery Review

### Recording 4

Clear, filler-free closing phrase at a deliberate spoken pace. The clip contains only four words and no Course Schedule explanation, so organization, vocal variation, and sustained perceived confidence cannot be meaningfully assessed.

_Duration: 5.12 seconds · Pace: 96 WPM_

**Observed fillers:** No counted filler words.

**Strengths**

- All four words are intelligible in the transcript, with no restart or self-correction.
- No filler words are present.
- The brief phrase reaches a clean verbal completion.

**Improvements**

- Record the substantive Course Schedule explanation so delivery can be assessed across setup, algorithm, complexity, and conclusion.
- Trim or avoid the roughly 2.62 seconds of trailing silence after the final word.
- For a fuller answer, use explicit signposts such as graph model, cycle-detection method, complexity, and conclusion.

### Recording 2

Moderate, easy-to-follow pace with brief pauses and some vocal variation. The core one-button idea is understandable, but filler-led transitions, vague wording, and the confirming tag question make the explanation less direct.

_Duration: 14.08 seconds · Pace: 136.4 WPM_

**Observed fillers:** okay (1), so (2), right? (1)

**Strengths**

- A measured pace of about 136 words per minute keeps the short answer from sounding rushed.
- The answer progresses from the current control to its expected behavior and then to the intended result.
- The closing phrase restates the main one-button outcome, making the central point identifiable.

**Improvements**

- Replace the unclear middle clause with precise wording, for example: “This activity button should control the whole flow.”
- Use a clean three-part structure: current behavior, expected behavior, result.
- Remove one or both “So” restarts and replace “all the things” with the exact actions the button completes.
- End with a direct statement instead of “right?” when confirmation is not needed.

### Recording 3

A brief, direct message delivered at a moderate overall pace. The main concern is understandable, but a repeated construction, one false start, profanity, and the lack of a specific next-step request make the delivery sound less controlled and organized than it could.

_Duration: 11.07 seconds · Pace: 119.2 WPM_

**Observed fillers:** No counted filler words.

**Strengths**

- The overall pace was moderate at 119.2 words per minute, so the short message was not rushed.
- The delivery states the concern directly and uses the specific word “transcripts,” making the subject easy to identify.
- The 0.72-second pause cleanly separates the first statement from the closing question.

**Improvements**

- Replace “being transferred, being transcripted” with one precise phrase, such as “I don’t see a transcript being transferred.”
- Remove the false start in “I, what…” and finish with one complete, actionable question.
- For a more controlled and professional delivery, replace profanity and “bro” with a neutral request such as “Can you check what happened?”
- Use a simple structure: observable issue, expected behavior, then requested next step.

### Recording 1

Moderate overall pace with clear opening intent, but three noticeable pauses, a mid-sentence restart, unclear referents, and a sharply accelerated closing question make the answer feel less controlled than it could. The voice shows useful pitch variation; a shorter, neutral problem-observation-question structure would sound more interview-ready.

_Duration: 17.28 seconds · Pace: 128.5 WPM_

**Observed fillers:** okay (1), so (1)

**Strengths**

- The overall pace is a listener-friendly 128.5 words per minute across the 17.28-second clip.
- The opening, “Okay, let me understand this correctly,” clearly signals that a clarification is coming.
- There are no “um” or “uh” fillers, and the final question has noticeably wider pitch variation than the preceding phrase.

**Improvements**

- Replace the restart “it takes so long, such a long time” with one complete sentence: “The transcription is taking a long time.”
- Name the subject directly instead of switching among “it” and “they,” then use a simple sequence: observation, impact, question.
- Keep the closing question near the earlier pace; the final seven words occur in about 1.5 seconds, much faster than the clip average.
- For interview settings, replace profanity and “bruh” with neutral wording so the directness reads as controlled and professional.
- Use the roughly one-second pause after “so much” as a deliberate sentence boundary rather than resuming the same unfinished clause.

## References

- [Course Schedule — problem description (LeetCode 207)](https://leetcode.com/problems/course-schedule/) — accessed 2026-07-22T10:22:06.525Z
