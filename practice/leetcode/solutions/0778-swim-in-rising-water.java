/*
 * LeetCode 778 - Swim in Rising Water
 * Canonical URL: https://leetcode.com/problems/swim-in-rising-water/
 *
 * Problem:
 * An n x n grid contains a permutation of 0..n^2-1. At time t the water
 * level is t, so a cell is traversable exactly when grid[r][c] <= t. Starting
 * at (0,0), return the minimum time at which one can reach (n-1,n-1) using
 * four-directional moves.
 *
 * Constraints:
 * - 1 <= n <= 50
 * - grid is a permutation of [0, n^2 - 1]
 *
 * Example 1:
 * grid = [[0,2], [1,3]] -> 3
 *     t=2: 0 2       the 3-cell is still underwater
 *           1 X
 *     t=3: 0 2       all four cells are reachable
 *           1 3
 *
 * Example 2:
 * grid = [[0,1,2,3,4], [24,23,22,21,5], [12,13,14,15,16],
 *         [11,18,17,20,19], [10,9,8,7,6]] -> 16
 * The answer is the minimum possible maximum elevation along a path.
 * Starter scaffold:
 */
class Solution {
    public int swimInWater(int[][] grid) {
        return 0;
    }
}
