/*
 * LeetCode 42 - Trapping Rain Water
 * Canonical URL: https://leetcode.com/problems/trapping-rain-water/
 *
 * Problem:
 * Given non-negative bars of unit width, compute the total water retained
 * after rainfall. At index i the water level is limited by the shorter of the
 * tallest bar on its left and the tallest bar on its right, then reduced by
 * height[i]. Water outside the two ends escapes.
 *
 * Constraints:
 * - 1 <= height.length <= 20_000
 * - 0 <= height[i] <= 100_000
 *
 * Example 1:
 * height = [0,1,0,2,1,0,1,3,2,1,2,1], answer = 6
 *
 * 3 |               █
 * 2 |       █ ~ ~ ~ █ █ ~ █
 * 1 |   █ ~ █ █ ~ █ █ █ █ █ █
 *   +-----------------------
 *     0 1 0 2 1 0 1 3 2 1 2 1
 *     █ = bar, ~ = trapped water
 *
 * index :  0 1 2 3 4 5 6 7 8 9 10 11
 * height:  0 1 0 2 1 0 1 3 2 1  2  1
 * water :  0 0 1 0 1 2 1 0 0 1  0  0
 * total trapped water = 6
 *
 * Example 2:
 * height = [4,2,0,3,2,5], answer = 9
 *
 * 5 |           █
 * 4 | █ ~ ~ ~ ~ █
 * 3 | █ ~ ~ █ ~ █
 * 2 | █ █ ~ █ █ █
 * 1 | █ █ ~ █ █ █
 *   +-----------
 *     4 2 0 3 2 5
 *     █ = bar, ~ = trapped water
 *
 * index : 0 1 2 3 4 5
 * height: 4 2 0 3 2 5
 * water : 0 2 4 1 2 0
 * total trapped water = 9
 *
 * Per-column formula: water[i] = max(0, min(maxLeft[i], maxRight[i])
 * - height[i]). The bars and water are shown as contiguous columns rather
 * than an array shorthand so the basin shape remains visible while coding.
 */

class Solution {
    public int trap(int[] height) {
        int l = height.length;
        int[] highR = new int[l];
        int[] highL = new int[l];

        for(int i=0; i<l; i++){
            int PreR = i==0 ? 0 : highR[i-1];
            int PreL = i==0 ? 0 : highL[l-i];
            highR[i] = Math.max(PreR, height[i]);
            highL[l-i-1] = Math.max(PreL, height[l-i-1]);
        }
        int res = 0;
        for(int i=0; i<l; i++){
            res += Math.min(highR[i], highL[i]) - height[i];
        }
        return res;
    }
}
