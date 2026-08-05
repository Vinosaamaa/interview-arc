/*
 * LeetCode 755 - Pour Water
 * Canonical URL: https://leetcode.com/problems/pour-water/
 *
 * Problem:
 * A one-dimensional terrain is represented by unit-width columns. Pour one
 * unit of water at index k, one unit at a time. A droplet first tries to move
 * left while descending; if it cannot, it tries to move right while
 * descending; otherwise it stays at k. Return the final column heights after
 * V units have been poured. A move cannot pass a column of equal or greater
 * height.
 *
 * Constraints:
 * - 1 <= heights.length <= 100
 * - 0 <= heights[i] <= 100
 * - 0 <= volume <= 2,000
 * - 0 <= k < heights.length
 *
 * Example 1:
 * heights = [2,1,1,2,1,2,2], volume = 4, k = 3
 * output = [2,2,2,3,2,2,2]
 *
 *     before: 2 1 1 2 1 2 2
 *     after : 2 2 2 3 2 2 2
 *                  ^ pour index k=3
 *
 * Example 2: [1,2,3,4], volume = 2, k = 2 -> [1,2,4,4]
 * Starter scaffold:
 */
class Solution {
    public int[] pourWater(int[] heights, int volume, int k) {
        return heights;
    }
}
