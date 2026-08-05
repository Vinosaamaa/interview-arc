/*
 * LeetCode 827 - Making A Large Island
 * Canonical URL: https://leetcode.com/problems/making-a-large-island/
 *
 * Problem:
 * Given an n x n binary grid, where 1 is land and 0 is water, change at most
 * one water cell to land. Return the largest possible island area, where an
 * island is connected through the four cardinal directions. If the grid is
 * already all land, return its current area.
 *

 * Constraints:
 * - 1 <= n <= 500
 * - grid[i][j] is 0 or 1
 *

 * Example 1:
 *     1 0
 *     0 1       Flip either zero -> one island of area 3.
 *     output = 3
 *

 * Example 2:
 *     1 1
 *     1 0       Flip the bottom-right cell -> area 4.
 *     output = 4
 *

 * Label picture: first label each existing island with a unique id and area;
 * for a candidate zero, sum the distinct neighboring island areas plus one.
 * Starter scaffold:
 */
class Solution {
    public int largestIsland(int[][] grid) {
        return 0;
    }
}
