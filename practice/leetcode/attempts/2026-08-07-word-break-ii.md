---
schema_version: 1
activity_id: 2026-08-07-extra-word-break-ii-msjrhfhv-1
question_id: word-break-ii
solution_profile_revision: 1
finalization_revision: 1
interaction_mode_classification_revision: 1
date: 2026-08-07
practice_timezone: America/Los_Angeles
type: leetcode
source: extra
record_kind: attempt
title: "Word Break II"
url: https://leetcode.com/problems/word-break-ii/
topics: [dynamic-programming, depth-first-search, memoization, backtracking, string]
status: completed
allocated_seconds: 2700
timing_source: website
elapsed_seconds: 5842
started_at: 2026-08-07T19:39:42.493-07:00
ended_at: 2026-08-07T21:38:16.044-07:00
user_attempted: true
outcome: solved
assistance_level: hint
audio_clips:
  - id: clip-15151aa0-4b3e-45eb-a804-07f16021e8af
    transcript_turn_id: voice-eb0e7b0d-8566-4593-b64c-2e245fc90295
audio_availability: private-r2
---

# Word Break II

## Pinned Notes

No pinned notes were recorded.

## Problem Reference

[Word Break II](https://leetcode.com/problems/word-break-ii/)

## Summary

Build all valid segmentation transitions and then enumerate their paths; either bottom-up predecessor DP or memoized DFS avoids recomputing impossible suffixes.

Outcome: solved. Elapsed time: 5842 seconds.

Interaction-mode snapshot revision 1: unrecorded; mentor assistance recorded; highest hint rung nudge.

## Activity Exchanges

> **User:**
> Let's see the problem. tiktok.com. Tiktok is a website for creating and distributing It's a fucking like a given string, and then each. I space it in S. Oh my God. You need to return all the possible sentences. Text on screen. That's fucking best feeling bro. Give me a string. No, the same word in dictionary. Maybe you reuse multiple times in the segmentation. Okay. Text on screen. Use it bro. Just another fucking use it bro. The learning process of the Text on screen. Text on screen. The first two pointers are the same as the first two. Text on screen. Text on screen. So first of all, this is a fucking DP. I guess it's a little bit similar to... what is that? What did we do yesterday? Yeah, yeah, yeah. What is that called? Word break? What we did yesterday was not Word Break Kesa. Oh my god. What is that? Yesterday, it is, um... Oh no it not basic calculator No the thing before that is Yeah, concatenated word. Concatenated word. Is that it? Concatenated word. Is that the fucking concatenation word? How do we do that actually? Oh yeah, that's different, okay. Uh, yeah, it's not concatenation word, but it's actually easier than that. And then, oh my god. Dude, it's essentially the same, it's just easier, you know? So yesterday, because yesterday it's like we return, oh my god, this is easier. We return once we find that, but this is like, we need to do the for loop. We do BFS with dynamic. Can we do that? Use a hash set, right? And basically we just generating from beginning. Oh, but we have to know like... We have to know where exactly it break. No, we have to trace back something. We need to do a little bit trace back, you know. Text on screen. Text on screen. How do we actually know If we just do the dynamic programming right We only know when it is So, just need to add a little bit of traceback, you know. Ah. A little bit backtracking. Yeah, I think we do a little backtracking, but the thing is how do we do that in a dynamic array? We just marked the parent, maybe. In that one, we know the previous, all the previous All right, fuck, it's gonna be the same thing as tomorrow, man. We just finished this one. You need to prepare for the behavior, bro. Let's see, I'll just finish this one quick. What I said is true, right? So in the dynamic table, instead of just the... Instead of just storing whether true or false, you need to store which index you went back and store that index. If that is true, you need to store that index. You need to store the index, you know. Isn't that true, bro? But what's the starting point? And finally, you just need to do a... Oh my god, I want to dump. Text on screen.

> **Specialist:**
> Your DP definition is correct:
>
> - `canForm[i]` means the prefix `s[0..i)` can be segmented.
> - `canForm[0] = true` is the dummy empty-prefix base case.
> - A valid transition from `j` to `i` exists when `canForm[j]` is true and `s[j..i)` is in the dictionary.
>
> Before implementing, answer one interviewer question: if several different indices `j` can lead into the same `i`, is storing only one predecessor enough when the problem asks for every sentence?

> **User:**
> of course, i am storing as a fuking list

> **Specialist:**
> Exactly. `parents[i]` must store every valid predecessor index `j`, not only one. That preserves every segmentation path.
>
> Next interviewer question: during traceback, when you reach index `0`, what exactly do you add to the result, and how will you avoid introducing a leading or trailing space?

> **User:**
> ok, i submited and passed leetcode, do the review, do not forget editorial

> **Specialist:**
> ## Review
>
> The local Java source correctly builds every valid predecessor edge and backtracks through that DAG to enumerate all sentences; your LeetCode pass report is consistent with the code.
>
> ### What went well
>
> - The prefix state is correct: index `i` represents `s[0..i)`, with index `0` as the reachable empty prefix.
> - Each endpoint stores every valid predecessor, so the reconstruction phase preserves all segmentation choices rather than only one path.
> - The DFS backtracks cleanly and emits complete sentences only when it reaches index `0`.
>
> ### What to improve
>
> - The stated `O(2^n)` time bound omits sentence-construction work; a clearer output-sensitive bound is `O(n^3 + nP)` with Java substring/hash costs, where `P` is the number of returned sentences.
> - The stated `O(2^n)` space bound should distinguish the predecessor graph from output storage: `O(n^2 + nP)` including returned sentences.
> - The listed empty-string edge case is outside the problem constraints, and the current base case would call `setLength(-1)` for an empty input; either remove that claim or guard the empty path.
> - Use clearer names such as `parents`, `end`, and `previous`, and prefer `List<List<Integer>>` over a generic array to avoid unchecked-array warnings.
>
> ### Testing evidence
>
> - User reported that this exact Java source was submitted to LeetCode and passed.
>
> ### Complexity verdict
>
> - Time: `O(n^3 + nP)` with Java substring/hash costs, where `P` is the number of returned sentences; worst-case `O(n * 2^n)`.
> - Space: `O(n^2 + nP)` including the predecessor graph and returned sentences; worst-case `O(n * 2^n)`.
>
> ### Edge cases
>
> - No valid segmentation returns an empty list.
> - A whole-string dictionary match produces one sentence.
> - Repeated dictionary-word reuse remains valid.
> - Many overlapping prefixes such as `a`, `aa`, and `aaa` create exponentially many outputs.
> - Empty input is outside the stated constraints; the current base case is not safe for it.
>
> ### Editorial comparison
>
> The official Editorial was available and presents four families: plain backtracking, memoized DFS, bottom-up tabulation, and trie-optimized tabulation. Your solution is closest to bottom-up tabulation, but instead of storing complete sentences at every index, it stores a predecessor DAG and performs one reconstruction DFS afterward. That separation is valid and keeps the DP table lighter than storing sentence strings at every position.
>
> The most concise interview implementation is memoized DFS by starting index: compute every sentence for a suffix once, cache it, and combine the current dictionary word with each cached suffix sentence.
>
> ### Independent reference implementation
>
> ```java
> import java.util.*;
>
> class Solution {
>     private String s;
>     private Set<String> dictionary;
>     private Map<Integer, List<String>> memo;
>     private int maxWordLength;
>
>     public List<String> wordBreak(
>         String s,
>         List<String> wordDict
>     ) {
>         this.s = s;
>         dictionary = new HashSet<>(wordDict);
>         memo = new HashMap<>();
>         maxWordLength = 0;
>
>         for (String word : wordDict) {
>             maxWordLength = Math.max(
>                 maxWordLength,
>                 word.length()
>             );
>         }
>
>         return sentencesFrom(0);
>     }
>
>     private List<String> sentencesFrom(int start) {
>         if (start == s.length()) {
>             return List.of("");
>         }
>         if (memo.containsKey(start)) {
>             return memo.get(start);
>         }
>
>         List<String> sentences = new ArrayList<>();
>         int limit = Math.min(
>             s.length(),
>             start + maxWordLength
>         );
>
>         for (int end = start + 1; end <= limit; end++) {
>             String word = s.substring(start, end);
>             if (!dictionary.contains(word)) {
>                 continue;
>             }
>
>             for (String suffix : sentencesFrom(end)) {
>                 sentences.add(
>                     suffix.isEmpty()
>                         ? word
>                         : word + " " + suffix
>                 );
>             }
>         }
>
>         memo.put(start, sentences);
>         return sentences;
>     }
> }
> ```
>
> ### Next step
>
> Reimplement the same idea once with `List<List<Integer>>` and an output-sensitive complexity comment, then compare it with memoized DFS returning sentences by start index.

> **User:**
> so my solution is not the best???? i thought we should use dp, wtf, is dfs easier and better?????

> **Specialist:**
> Your solution is not worse. It is a strong DP solution:
>
> - `dyna[i]` is bottom-up DP: it records every predecessor that can form prefix `s[0..i)`.
> - Your final DFS only enumerates paths through that already-built predecessor DAG.
> - Memoized DFS is also DP—top-down DP. Its state is `start -> every sentence constructible from this suffix`.
>
> Memoized DFS is easier to write and explain because it directly returns sentences. It is not universally faster or more memory-efficient. Your design stores integer predecessor edges instead of caching many partially constructed sentence strings, which can make its intermediate representation leaner.
>
> Both approaches must spend exponential time when the answer itself contains exponentially many sentences. Your build phase can be improved by checking only the previous `maxWordLength` characters; with maximum dictionary length `L`, that changes the prefix-building work from roughly `O(n^3)` substring/hash work to `O(n * L^2)`, followed by the unavoidable `O(nP)` output reconstruction.
>
> So: DFS is more concise, not inherently better. You do not need to replace your algorithm. For an interview, I would keep your DP-plus-predecessor-DAG approach, improve the names and complexity explanation, and bound the substring scan by the maximum dictionary-word length.

## User Attempt

### Code Attempt 1

- Attempt ID: `attempt-2026-08-07-word-break-ii-1`
- Occurred at: 2026-08-07T21:40:05.000-07:00
- Observed correctness: appears_correct
- Final declaration: User reported that this exact Java source was submitted to LeetCode and passed.

```java
import java.util.*;

/*
 * LeetCode 140 - Word Break II
 *
 * https://leetcode.com/problems/word-break-ii/
 *
 * Problem
 * -------
 * Given a lowercase string s and a dictionary of unique
 * lowercase words, insert spaces into s so that every
 * resulting token is a dictionary word. Return every
 * valid sentence in any order.
 *
 * A dictionary word may be reused multiple times. If no
 * complete segmentation exists, return an empty list.
 * Every returned sentence must consume every character
 * of s exactly once and preserve the original order.
 *
 * Example 1
 * ---------
 * Input:
 *   s = "catsanddog"
 *   wordDict = ["cat", "cats", "and", "sand", "dog"]
 *
 * Output:
 *   ["cats and dog", "cat sand dog"]
 *
 * Valid boundaries:
 *   cats | and  | dog
 *   cat  | sand | dog
 *
 * Example 2
 * ---------
 * Input:
 *   s = "pineapplepenapple"
 *   wordDict = ["apple", "pen", "applepen",
 *               "pine", "pineapple"]
 *
 * Output:
 *   ["pine apple pen apple",
 *    "pineapple pen apple",
 *    "pine applepen apple"]
 *
 * The word "apple" is reused in the first sentence.
 *
 * Example 3
 * ---------
 * Input:
 *   s = "catsandog"
 *   wordDict = ["cats", "dog", "sand", "and", "cat"]
 *
 * Output:
 *   []
 *
 * Constraints
 * -----------
 * - 1 <= s.length <= 20
 * - 1 <= wordDict.length <= 1000
 * - 1 <= wordDict[i].length <= 10
 * - s and every dictionary word contain only lowercase
 *   English letters.
 * - All dictionary words are unique.
 * - The generated answer length is at most 100,000.
 *
 * Required Java API
 * -----------------
 * class Solution
 * public List<String> wordBreak(
 *     String s,
 *     List<String> wordDict)
 */
class Solution {
    public List<String> wordBreak(String s, List<String> wordDict) {
        int n = s.length();
        List<Integer>[] dyna = new ArrayList[n + 1];

        HashSet<String> dict = new HashSet<>(wordDict);

        dyna[0] = new ArrayList<>();

        for(int i = 0; i<n; i++){
            int ii = i + 1;
            for(int j=i; j>=0; j-- ){
                if(dict.contains(s.substring(j, ii)) && dyna[j] != null){
                    if(dyna[ii] == null) dyna[ii] =  new ArrayList<>();
                    dyna[ii].add(j);
                }
            }
        }

        List<String> res = new ArrayList<>();
        if(dyna[n] == null) return res;

        dfs(dyna, res, new ArrayList<String>(), n, s);

        return res;
    }

    void dfs(List<Integer>[] dyna, List<String> res, List<String> cur, int root, String s){
        if(root == 0){
            StringBuilder sb = new StringBuilder();

            for(int i=cur.size() - 1; i>=0; i--) sb.append(cur.get(i)).append(" ");
            sb.setLength(sb.length() - 1);
            res.add(sb.toString());
            return;
        }

        for(int i : dyna[root]){
            String added = s.substring(i, root);
            cur.add(added);
            dfs(dyna, res, cur, i, s);
            cur.removeLast();
        }
    }
}

/*
 *time complexity: O(2**n)
 *space complexity: O(2**n)
 *edge case: empty string, string like a, aa, aaa, aaaa,aaaaaa
 *
 * */
```

#### Attempt 1 review

The local Java source correctly builds every valid predecessor edge and backtracks through that DAG to enumerate all sentences; your LeetCode pass report is consistent with the code.

**Observed correctness:** appears_correct

**What went well**
- The prefix state is correct: index `i` represents `s[0..i)`, with index `0` as the reachable empty prefix.
- Each endpoint stores every valid predecessor, so the reconstruction phase preserves all segmentation choices rather than only one path.
- The DFS backtracks cleanly and emits complete sentences only when it reaches index `0`.

**What to improve**
- The stated `O(2^n)` time bound omits sentence-construction work; a clearer output-sensitive bound is `O(n^3 + nP)` with Java substring/hash costs, where `P` is the number of returned sentences.
- The stated `O(2^n)` space bound should distinguish the predecessor graph from output storage: `O(n^2 + nP)` including returned sentences.
- The listed empty-string edge case is outside the problem constraints, and the current base case would call `setLength(-1)` for an empty input; either remove that claim or guard the empty path.
- Use clearer names such as `parents`, `end`, and `previous`, and prefer `List<List<Integer>>` over a generic array to avoid unchecked-array warnings.

**Testing evidence**
- User reported that this exact Java source was submitted to LeetCode and passed.

**Next step:** Reimplement the same idea once with `List<List<Integer>>` and an output-sensitive complexity comment, then compare it with memoized DFS returning sentences by start index.

## Agent Solution

#### Review

The local Java source correctly builds every valid predecessor edge and backtracks through that DAG to enumerate all sentences; your LeetCode pass report is consistent with the code.

##### What went well

- The prefix state is correct: index `i` represents `s[0..i)`, with index `0` as the reachable empty prefix.
- Each endpoint stores every valid predecessor, so the reconstruction phase preserves all segmentation choices rather than only one path.
- The DFS backtracks cleanly and emits complete sentences only when it reaches index `0`.

##### What to improve

- The stated `O(2^n)` time bound omits sentence-construction work; a clearer output-sensitive bound is `O(n^3 + nP)` with Java substring/hash costs, where `P` is the number of returned sentences.
- The stated `O(2^n)` space bound should distinguish the predecessor graph from output storage: `O(n^2 + nP)` including returned sentences.
- The listed empty-string edge case is outside the problem constraints, and the current base case would call `setLength(-1)` for an empty input; either remove that claim or guard the empty path.
- Use clearer names such as `parents`, `end`, and `previous`, and prefer `List<List<Integer>>` over a generic array to avoid unchecked-array warnings.

##### Testing evidence

- User reported that this exact Java source was submitted to LeetCode and passed.

##### Complexity verdict

- Time: `O(n^3 + nP)` with Java substring/hash costs, where `P` is the number of returned sentences; worst-case `O(n * 2^n)`.
- Space: `O(n^2 + nP)` including the predecessor graph and returned sentences; worst-case `O(n * 2^n)`.

##### Edge cases

- No valid segmentation returns an empty list.
- A whole-string dictionary match produces one sentence.
- Repeated dictionary-word reuse remains valid.
- Many overlapping prefixes such as `a`, `aa`, and `aaa` create exponentially many outputs.
- Empty input is outside the stated constraints; the current base case is not safe for it.

##### Editorial comparison

The official Editorial was available and presents four families: plain backtracking, memoized DFS, bottom-up tabulation, and trie-optimized tabulation. Your solution is closest to bottom-up tabulation, but instead of storing complete sentences at every index, it stores a predecessor DAG and performs one reconstruction DFS afterward. That separation is valid and keeps the DP table lighter than storing sentence strings at every position.

The most concise interview implementation is memoized DFS by starting index: compute every sentence for a suffix once, cache it, and combine the current dictionary word with each cached suffix sentence.

##### Independent reference implementation

```java
import java.util.*;

class Solution {
    private String s;
    private Set<String> dictionary;
    private Map<Integer, List<String>> memo;
    private int maxWordLength;

    public List<String> wordBreak(
        String s,
        List<String> wordDict
    ) {
        this.s = s;
        dictionary = new HashSet<>(wordDict);
        memo = new HashMap<>();
        maxWordLength = 0;

        for (String word : wordDict) {
            maxWordLength = Math.max(
                maxWordLength,
                word.length()
            );
        }

        return sentencesFrom(0);
    }

    private List<String> sentencesFrom(int start) {
        if (start == s.length()) {
            return List.of("");
        }
        if (memo.containsKey(start)) {
            return memo.get(start);
        }

        List<String> sentences = new ArrayList<>();
        int limit = Math.min(
            s.length(),
            start + maxWordLength
        );

        for (int end = start + 1; end <= limit; end++) {
            String word = s.substring(start, end);
            if (!dictionary.contains(word)) {
                continue;
            }

            for (String suffix : sentencesFrom(end)) {
                sentences.add(
                    suffix.isEmpty()
                        ? word
                        : word + " " + suffix
                );
            }
        }

        memo.put(start, sentences);
        return sentences;
    }
}
```

##### Next step

Reimplement the same idea once with `List<List<Integer>>` and an output-sensitive complexity comment, then compare it with memoized DFS returning sentences by start index.

### Exact Solution Profile Revision

Question `word-break-ii`, revision 1.

### Pattern recognition and constraints

This is word-break reachability plus output enumeration. A boolean DP is insufficient because every valid sentence must be returned. The state must retain all predecessor choices or memoize all sentence suffixes.

### Best approach

Memoized DFS by start index is concise: for every dictionary word matching s at start, recursively obtain every sentence for the remaining suffix and prepend the word. Cache the complete list for each start index, including an empty list for failure. An empty terminal suffix contributes one empty continuation so the last word can form a sentence.

### Java reference implementation

```java
import java.util.*;

class Solution {
    private String s;
    private Set<String> dictionary;
    private Map<Integer, List<String>> memo;
    private int maxWordLength;

    public List<String> wordBreak(
        String s,
        List<String> wordDict
    ) {
        this.s = s;
        dictionary = new HashSet<>(wordDict);
        memo = new HashMap<>();
        maxWordLength = 0;

        for (String word : wordDict) {
            maxWordLength = Math.max(
                maxWordLength,
                word.length()
            );
        }

        return sentencesFrom(0);
    }

    private List<String> sentencesFrom(int start) {
        if (start == s.length()) {
            return List.of("");
        }
        if (memo.containsKey(start)) {
            return memo.get(start);
        }

        List<String> sentences = new ArrayList<>();
        int limit = Math.min(
            s.length(),
            start + maxWordLength
        );

        for (int end = start + 1; end <= limit; end++) {
            String word = s.substring(start, end);
            if (!dictionary.contains(word)) {
                continue;
            }

            for (String suffix : sentencesFrom(end)) {
                sentences.add(
                    suffix.isEmpty()
                        ? word
                        : word + " " + suffix
                );
            }
        }

        memo.put(start, sentences);
        return sentences;
    }
}
```

### Correctness reasoning

For a start index, the DFS tries every dictionary prefix beginning there. Any valid sentence must begin with exactly one such prefix, and the recursion enumerates every valid completion after it. Conversely, every constructed result is a dictionary word followed by a valid recursively constructed suffix, so it is valid. Memoization reuses the exact result set for the same suffix without removing any sentence.

### Time and space complexity

Let P be the number of returned sentences. With Java substring/hash costs, preprocessing/search plus output construction is output-sensitive, commonly expressed as O(n³ + nP) for the predecessor-DAG formulation and worst-case O(n·2^n). Space is O(n² + nP), including stored transitions or memoized sentences and returned output.

### Edge cases

No valid segmentation returns empty; a whole-string dictionary match returns one sentence; dictionary words may be reused; overlapping prefixes can create exponentially many outputs; empty input is outside the stated constraints unless explicitly handled.

### Meaningful alternatives

The user’s bottom-up DP stores every predecessor j for each reachable end i, forming a DAG over prefix indices; DFS backward from n to 0 enumerates sentences. It is fully correct and exposes reachability before enumeration, while memoized DFS is often shorter.

### Common mistakes and recall cues

Store every valid predecessor, not just one. Cache failures as well as successes. Distinguish unavoidable output size from avoidable recomputation. Recall cue: build all segmentation edges, then enumerate paths.

## What Went Well

- The prefix state is correct: index `i` represents `s[0..i)`, with index `0` as the reachable empty prefix.
- Each endpoint stores every valid predecessor, so the reconstruction phase preserves all segmentation choices rather than only one path.
- The DFS backtracks cleanly and emits complete sentences only when it reaches index `0`.

## What To Improve

- The stated `O(2^n)` time bound omits sentence-construction work; a clearer output-sensitive bound is `O(n^3 + nP)` with Java substring/hash costs, where `P` is the number of returned sentences.
- The stated `O(2^n)` space bound should distinguish the predecessor graph from output storage: `O(n^2 + nP)` including returned sentences.
- The listed empty-string edge case is outside the problem constraints, and the current base case would call `setLength(-1)` for an empty input; either remove that claim or guard the empty path.
- Use clearer names such as `parents`, `end`, and `previous`, and prefer `List<List<Integer>>` over a generic array to avoid unchecked-array warnings.

## Review Plan

No review was scheduled in D1 at publication time.

## Delivery Recordings

- `clip-15151aa0-4b3e-45eb-a804-07f16021e8af` — transcript turn `voice-eb0e7b0d-8566-4593-b64c-2e245fc90295`; 890 seconds; available.

## Delivery Review

### clip-15151aa0-4b3e-45eb-a804-07f16021e8af

Status: available.

A highly fragmented think-aloud with very low overall verbal throughput because extended silent intervals occupy much of the recording. The eventual reconstruction insight is concrete, but repeated restarts, filler-like address terms, expletive-heavy self-commentary, shifting algorithm labels, and question-tag hedges make the explanation harder to follow and less assured than it could sound. Use a four-part scaffold—goal, state, transition, reconstruction—and give one brief checkpoint after any thinking pause.

- Duration: 890.492 seconds
- Pace: 34.4 words per minute

**Strengths**
- Uses occasional reset and transition phrases such as “Alright, let’s get back to this” and “So first of all,” which show an ability to re-enter the explanation after interruption.
- Eventually gives a concrete contrast—store predecessor indices instead of only true/false—which is the clearest and most interview-ready portion of the delivery.
- Self-corrects aloud from an earlier-problem comparison toward the need for traceback/backtracking, making the evolution of the proposed approach observable.

**Improvements**
- Open with a neutral reset sentence and remove expletive-heavy self-commentary and repeated “bro/bruh”; this will make the first impression more professional and keep attention on the algorithm.
- Before exploring details, state a four-part roadmap: what must be returned, the DP state, how transitions are found, and how complete sentences are reconstructed.
- Time-box silent thinking to roughly 3–5 seconds; after a longer pause, say one checkpoint such as “I need to preserve every predecessor so I can enumerate all paths.”
- Reduce fillers and question-tag hedges. After validating an idea, replace “maybe,” “right?” or “isn’t that true?” with one declarative decision.
- End with a 20-second recap of the chosen approach and its data flow instead of trailing off mid-sentence.

**Observations**
- **pace:** After removing obvious transcript artifacts, about 511 words occur across 890.62 seconds, or 34.4 words per minute over the full recording. Coaching: The low overall rate is driven by long gaps rather than uniformly slow articulation. Use short, complete explanation bursts separated by brief thinking pauses.
- **pauses:** Word timestamps contain multiple directly supported gaps above 25 seconds, including approximately 107.66–148.72, 162.00–211.44, 296.66–344.40, and 618.85–652.79. Coaching: A short silent pause is fine, but narrate a checkpoint before or after an extended one so the interviewer can follow what question you are resolving.
- **fillers:** The transcript contains 7 instances of “yeah,” 5 of “like,” 4 of “you know,” 7 of “bro,” 3 of “bruh,” plus repeated interjections such as “oh my god.” Coaching: Replace filler strings with a one-beat pause, and replace address terms/interjections with precise transitions such as “The key constraint is…” or “I’m revising the state.”
- **clarity:** The explanation shifts among “DP,” “BFS with dynamic,” “traceback,” “backtracking,” and “mark the parent” before the clearest statement: store predecessor indices rather than only true/false. Coaching: Define each term once and connect it to one data structure: DP records valid predecessors; DFS/backtracking enumerates sentences from those predecessors.
- **organization:** The answer moves from prompt fragments to yesterday’s problem, then BFS/DP, then traceback/backtracking, without an upfront roadmap or final recap. Coaching: Use a fixed sequence: restate output, define state, describe transition, reconstruct answers, then give complexity.
- **vocal variation:** The opening and several resets use emphatic interjections, while the technical explanation is broken by long silence and unfinished phrases. Coaching: Reserve emphasis for key algorithmic decisions and use a steadier baseline for the rest; this makes vocal variation support meaning rather than compete with it.
- **perceived confidence:** Frequent hedges and question tags—“I guess,” “maybe,” “Can we do that?”, “right?”, and “Isn’t that true?”—combine with repeated restarts. Coaching: It is fine to explore, but close each exploration with a firm sentence: “I’ll use DP to store all predecessors, then backtrack to generate every sentence.”

## References

- [LeetCode 140 — Word Break II](https://leetcode.com/problems/word-break-ii/) — accessed 2026-08-07.
