/*
 * LeetCode 11 - Container With Most Water
 * Canonical URL: https://leetcode.com/problems/container-with-most-water/
 *
 * Problem:
 * Given non-negative line heights at integer x-coordinates, choose two lines
 * and the x-axis to form a container. Return the maximum amount of water it
 * can hold. The container sides stay vertical; water cannot be poured around
 * either side and the lines cannot be slanted.
 *
 * Constraints:
 * - 2 <= height.length <= 100,000
 * - 0 <= height[i] <= 10,000
 *
 * Examples:
 * - [1,8,6,2,5,4,8,3,7] -> 49
 * - [1,1] -> 1
 *
 * Visual for the first example (selected boundaries i=1 and j=8):
 *
 *          height
 *           8 |  ·· ██ ·· ·· ·· ·· ██ ·· ··
 *           7 |  ·· ██ ░░ ░░ ░░ ░░ ██ ░░ ██
 *           6 |  ·· ██ ██ ░░ ░░ ░░ ██ ░░ ██
 *           5 |  ·· ██ ██ ░░ ██ ░░ ██ ░░ ██
 *           4 |  ·· ██ ██ ░░ ██ ██ ██ ░░ ██
 *           3 |  ·· ██ ██ ░░ ██ ██ ██ ██ ██
 *           2 |  ·· ██ ██ ██ ██ ██ ██ ██ ██
 *           1 |  ██ ██ ██ ██ ██ ██ ██ ██ ██
 *             +-----------------------------
 *                0   1   2   3   4   5   6   7   8
 *
 * ██ = line, ░░ = water, ·· = outside the selected container.
 * The width is 7 and the limiting height is 7, so the highlighted
 * container holds 7 * 7 = 49.
 *
 * Formula: area(i,j) = (j-i) * min(height[i], height[j]). The diagram uses
 * solid bars for boundary lines and shaded cells for the water between them.
 * Starter scaffold:
 */
class Solution {
    public int maxArea(int[] height) {
        int left = 0, right = height.length-1;
        int res = 0;

        while(left < right){
            res = Math.max(res, (right - left)* Math.min(height[right],height[left]));
            if(height[right]>=height[left]) left++;
            else right--;
        }

        return res;
    }
}
