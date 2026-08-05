/*
 * LeetCode 772 - Basic Calculator III
 * Canonical URL: https://leetcode.com/problems/basic-calculator-iii/
 *
 * Problem:
 * Evaluate a valid expression containing non-negative integers, '+', '-',
 * '*', '/', parentheses, and spaces. Multiplication and division have higher
 * precedence than addition and subtraction; parentheses override precedence.
 * Division truncates toward zero. Return the integer result.
 *
 * Constraints:
 * - 1 <= s.length <= 100,000
 * - s contains digits, operators, parentheses, and spaces
 * - Every intermediate result fits in a signed 32-bit integer
 * - The expression is valid; no unary operator appears where it is forbidden
 *
 * Examples:
 * - "1+1" -> 2
 * - "6-4/2" -> 4
 * - "2*(5+5*2)/3+(6/2+8)" -> 21
 *
 * Precedence picture:
 *     2 * (5 + 5 * 2) / 3 + (6 / 2 + 8)
 *     └────── product ──────┘   └─ group ─┘
 * A recursive descent or operator stack must finish * and / terms before
 * combining the surrounding + and - terms.
 * Starter scaffold:
 */
class Solution {
    public int calculate(String s) {
        return 0;
    }
}
