import java.util.*;

/*
 * LeetCode 51 - N-Queens
 * Canonical URL: https://leetcode.com/problems/n-queens/
 *
 * Problem:
 * Place n queens on an n x n chessboard so that no two queens attack one
 * another. Queens attack along a shared row, column, or either diagonal.
 * Return every distinct board arrangement; each board uses 'Q' for a queen
 * and '.' for an empty square. The order of the returned arrangements does
 * not matter.
 *
 * Constraints:
 * - 1 <= n <= 9
 *
 * Example 1:
 * n = 4 -> two solutions (shown as one of them):
 *
 *     . Q . .
 *     . . . Q
 *     Q . . .
 *     . . Q .
 *
 * Example 2:
 * n = 1 -> [["Q"]]
 *
 * State picture for backtracking: a candidate at (row, col) is legal only
 * when its column, row-col diagonal, and row+col diagonal are unused.
 * Starter scaffold:
 */
class Solution {
    public List<List<String>> solveNQueens(int n) {
        return new ArrayList<>();
    }
}
