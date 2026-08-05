/*
 * LeetCode 407 - Trapping Rain Water II
 * Canonical URL: https://leetcode.com/problems/trapping-rain-water-ii/
 *
 * Problem:
 * Given an m x n elevation map, where every cell is a one-unit square, return
 * how many units of rain water can be trapped after raining. Water flows only
 * through the four cardinal neighbors and can escape across the outer border.
 * A cell's retained water is limited by the lowest boundary reachable from it.
 *
 * Constraints:
 * - 1 <= m, n <= 200
 * - 1 <= m * n <= 20,000
 * - 0 <= heightMap[r][c] <= 20,000
 *
 * Example 1:
 * heightMap = [[1,4,3,1,3,2], [3,2,1,3,2,4], [2,3,3,2,3,1]] -> 4
 *
 *     1 4 3 1 3 2
 *     3 2 1 3 2 4       The four trapped units sit in the interior low cells;
 *     2 3 3 2 3 1       the border cells form the escape boundary.
 *
 * Example 2:
 * [[3,3,3,3,3],
 *  [3,2,2,2,3],
 *  [3,2,1,2,3],
 *  [3,3,3,3,3]] -> 10
 *
 *     3 3 3 3 3
 *     3 2 ~ 2 3       ~ marks water above the center basin; every border
 *     3 2 1 2 3       height 3 cell is part of the minimum boundary.
 *     3 3 3 3 3
 * Starter scaffold:
 */
class Solution {
    public int trapRainWater(int[][] heightMap) {
        return 0;
    }
}
