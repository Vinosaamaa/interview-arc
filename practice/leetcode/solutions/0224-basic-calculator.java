/*
 * LeetCode 224 - Basic Calculator
 * Canonical URL: https://leetcode.com/problems/basic-calculator/
 *
 * Problem:
 * Evaluate a valid arithmetic expression containing non-negative integers,
 * '+', '-', parentheses, and optional spaces. Parentheses may be nested and
 * a leading '-' may be unary, but a leading '+' is not. Return the integer
 * result; every number and running calculation fits in a signed 32-bit int.
 *
 * Constraints:
 * - 1 <= s.length <= 300,000
 * - s contains digits, '+', '-', '(', ')', and spaces
 * - s is a valid expression; '-' may be unary (for example "-(2+3)")
 * - '+' is never used as a unary operator and no two operators are adjacent
 *
 * Examples:
 * - "1 + 1" -> 2
 * - " 2-1 + 2 " -> 3
 * - "(1+(4+5+2)-3)+(6+8)" -> 23
 *
 * Parse picture for the last example:
 *     ( 1 + ( 4 + 5 + 2 ) - 3 ) + ( 6 + 8 )
 *       nested group A                    group B
 * A stack stores the sign/value context that is suspended at each '('.
 * Starter scaffold:
 */
class Solution {
    public int calculate(String s) {
        return 0;
    }
}
