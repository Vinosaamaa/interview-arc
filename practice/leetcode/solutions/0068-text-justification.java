import java.util.*;

/*
 * LeetCode 68 - Text Justification
 * Canonical URL: https://leetcode.com/problems/text-justification/
 *
 * Problem:
 * Pack the words into lines of exactly maxWidth characters. Use as many
 * words as fit on each line (greedy packing). For a non-final line, distribute
 * the extra spaces as evenly as possible; if the gaps are not equal, the
 * leftmost gaps receive the extra spaces. The final line is left-justified:
 * one space separates adjacent words and any remaining characters are spaces
 * at the end. A word must never be split.
 *
 * Constraints:
 * - 1 <= words.length <= 300
 * - 1 <= words[i].length <= 20
 * - words[i] contains English letters and digits
 * - 1 <= maxWidth <= 100
 * - words[i].length <= maxWidth
 *
 * Example:
 * words = ["This","is","an","example","of","text","justification."]
 * maxWidth = 16
 * output:
 *     "This    is    an"
 *     "example  of text"
 *     "justification.  "
 *
 * Layout picture (16 columns):
 *     |This....is....an|
 *     |example..of.text|
 *     |justification...|
 *     where dots represent spaces and the last row is left-justified.
 * Starter scaffold:
 */
class Solution {
    public List<String> fullJustify(String[] words, int maxWidth) {
        return new ArrayList<>();
    }
}
