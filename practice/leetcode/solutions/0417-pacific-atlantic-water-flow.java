import java.util.*;

/*
 * LeetCode 417 - Pacific Atlantic Water Flow
 * Canonical URL: https://leetcode.com/problems/pacific-atlantic-water-flow/
 *
 * Problem:
 * For an m x n matrix of heights, water may move north, south, east, or west
 * from a cell to a neighbor of equal or lower height. The Pacific touches the
 * top and left edges; the Atlantic touches the bottom and right edges. Return
 * every coordinate from which water can reach both oceans, in any order.
 *
 * Constraints:
 * - 1 <= m, n <= 200
 * - 1 <= m * n <= 40,000
 * - 0 <= heights[r][c] <= 100,000
 *
 * Example:
 * heights = [[1,2,2,3,5], [3,2,3,4,4], [2,4,5,3,1],
 *            [6,7,1,4,5], [5,1,1,2,4]]
 * Output = [[0,4],[1,3],[1,4],[2,2],[3,0],[3,1],[4,0]]
 *
 *     Pacific
 *     ↓ 1 2 2 3 5 → Atlantic
 *     ↓ 3 2 3 4 4 →
 *     ↓ 2 4 5 3 1 →
 *     ↓ 6 7 1 4 5 →
 *     ↓ 5 1 1 2 4 →
 *     ↑             ↑
 * Reverse reachability starts at each ocean edge and moves from a cell to a
 * neighbor whose height is at least as high; intersect the two visited sets.
 * Starter scaffold:
 */
class Solution {
    public List<List<Integer>> pacificAtlantic(int[][] heights) {
        return new ArrayList<>();
    }
}
