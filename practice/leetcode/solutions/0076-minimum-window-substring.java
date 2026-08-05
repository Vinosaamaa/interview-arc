/*
 * LeetCode 76 - Minimum Window Substring
 * Canonical URL: https://leetcode.com/problems/minimum-window-substring/
 *
 * Problem:
 * Given strings s and t, return the shortest contiguous substring of s that
 * contains every character of t, including repeated occurrences. Characters
 * may appear extra times in the window. If no such window exists, return the
 * empty string. When multiple windows have the same minimum length, any one
 * is acceptable.
 *
 * Constraints:
 * - 1 <= s.length, t.length <= 100,000
 * - s and t consist of English letters
 *
 * Example 1:
 * s = "ADOBECODEBANC", t = "ABC" -> "BANC"
 *
 *     ADOBECODEBANC
 *         [B A N C]  <- shortest window containing A, B, and C
 *
 * Example 2: s = "a", t = "a" -> "a"
 * Example 3: s = "a", t = "aa" -> ""
 *
 * Sliding-window picture:
 * expand right until all required counts are present, then move left while
 * the window remains valid. The answer is the smallest valid interval seen.
 * Starter scaffold:
 */
class Solution {
    public String minWindow(String s, String t) {
        return "";
    }
}
